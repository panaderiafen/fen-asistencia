// Simulador mínimo de Google Apps Script para probar los scripts de Fën en Node.
// Imita lo que importa para las pruebas: planillas en memoria (con la conversión
// automática de Sheets: "0123" → 123, "2026-09-30" → fecha, "08:30" → hora),
// propiedades del script, caché con vencimiento, bloqueo, SHA-256 y respuestas JSON.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');

function convertir(v, formato) {
  if (formato === '@' || typeof v !== 'string') return v;
  const s = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return new Date(1899, 11, 30, +m[1], +m[2]);
  if (s === 'TRUE' || s === 'true') return true;
  if (s === 'FALSE' || s === 'false') return false;
  return v;
}

class Hoja {
  constructor(nombre, filas) {
    this.nombre = nombre;
    this.celdas = (filas || []).map(f => f.slice());
    this.formatos = {}; // "fila,col" → formato
  }
  getName() { return this.nombre; }
  ancho() { return this.celdas.reduce((m, f) => Math.max(m, f.length), 0); }
  getLastRow() {
    for (let i = this.celdas.length - 1; i >= 0; i--) if (this.celdas[i].some(v => v !== '' && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() { return this.ancho(); }
  _get(r, c) { const f = this.celdas[r - 1]; const v = f ? f[c - 1] : undefined; return v === undefined ? '' : v; }
  _set(r, c, v) {
    while (this.celdas.length < r) this.celdas.push([]);
    const f = this.celdas[r - 1];
    while (f.length < c) f.push('');
    f[c - 1] = convertir(v, this.formatos[r + ',' + c] || this.formatos['*,' + c]);
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.ancho(), 1)); }
  getRange(r, c, h, w) { return new Rango(this, r, c, h || 1, w || 1); }
  appendRow(fila) { const r = this.getLastRow() + 1; fila.forEach((v, i) => this._set(r, i + 1, v)); return this; }
  insertRowAfter(r) { this.celdas.splice(r, 0, []); }
  insertRowsAfter(r, n) { for (let i = 0; i < n; i++) this.celdas.splice(r, 0, []); }
  deleteRow(r) { this.celdas.splice(r - 1, 1); }
  setFrozenRows() {} setColumnWidth() {} isSheetHidden() { return false; }
}

class Rango {
  constructor(h, r, c, alto, ancho) { Object.assign(this, { h, r, c, alto, ancho }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.alto; i++) { const f = []; for (let j = 0; j < this.ancho; j++) f.push(this.h._get(this.r + i, this.c + j)); out.push(f); }
    return out;
  }
  getValue() { return this.h._get(this.r, this.c); }
  setValue(v) { this.h._set(this.r, this.c, v); return this; }
  setValues(m) { m.forEach((f, i) => f.forEach((v, j) => this.h._set(this.r + i, this.c + j, v))); return this; }
  setNumberFormat(fmt) {
    if (this.alto > 1) { this.h.formatos['*,' + this.c] = fmt; }
    for (let i = 0; i < this.alto; i++) for (let j = 0; j < this.ancho; j++) this.h.formatos[(this.r + i) + ',' + (this.c + j)] = fmt;
    return this;
  }
  setBackground() { return this; } setFontColor() { return this; } setFontWeight() { return this; }
  setHorizontalAlignment() { return this; }
}

class Planilla {
  constructor(hojas) { this.hojas = {}; Object.entries(hojas || {}).forEach(([n, f]) => { this.hojas[n] = new Hoja(n, f); }); }
  getSheetByName(n) { return this.hojas[n] || null; }
  insertSheet(n) { this.hojas[n] = new Hoja(n, []); return this.hojas[n]; }
  getSheets() { return Object.values(this.hojas); }
  getId() { return 'planilla-prueba'; }
}

function crearEntorno(planilla, opciones = {}) {
  const ahora = opciones.ahora || (() => Date.now());
  const propiedades = {};
  const cache = {};
  const correos = [];
  const registro = [];
  const env = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => planilla,
      openById: () => planilla,
      getUi: () => ({ alert() {} }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in propiedades ? propiedades[k] : null),
        setProperty: (k, v) => { propiedades[k] = String(v); },
        deleteProperty: k => { delete propiedades[k]; },
        getProperties: () => Object.assign({}, propiedades),
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: k => { const e = cache[k]; if (!e || e.vence < ahora()) return null; return e.v; },
        put: (k, v, seg) => { cache[k] = { v: String(v), vence: ahora() + (seg || 600) * 1000 }; },
        remove: k => { delete cache[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, texto) => Array.from(crypto.createHash('sha256').update(String(texto), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => d.toISOString(),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (t) => ({ contenido: t, setMimeType() { return this; }, getContent() { return this.contenido; } }),
    },
    Logger: { log: (m) => registro.push(String(m)) },
    Session: { getScriptTimeZone: () => 'America/Santiago' },
    GmailApp: { sendEmail: (para, asunto, cuerpo, ops) => correos.push({ para, asunto, cuerpo, adjuntos: ops && ops.attachments }) },
    MailApp: { sendEmail: (para, asunto, cuerpo) => correos.push({ para, asunto, cuerpo }) },
    DriveApp: {
      getFileById: () => ({ getBlob: () => ({}), getAs: () => ({ setName() { return this; } }), setTrashed() {} }),
    },
    DocumentApp: {
      ParagraphHeading: { HEADING1: 1, HEADING2: 2 },
      create: () => {
        const texto = { setFontSize() { return texto; }, setBold() { return texto; }, setForegroundColor() { return texto; }, setItalic() { return texto; } };
        const parrafo = { setHeading() { return parrafo; }, editAsText: () => texto };
        const celda = { editAsText: () => texto, setBackgroundColor() {} };
        const tabla = { setBorderWidth() {}, getRow: () => ({ editAsText: () => texto, getNumCells: () => 1, getCell: () => celda }) };
        const body = {
          setMarginTop() { return body; }, setMarginBottom() { return body; }, setMarginLeft() { return body; }, setMarginRight() { return body; },
          appendImage: () => ({ setWidth() { return this; }, setHeight() { return this; } }),
          appendParagraph: () => parrafo, appendHorizontalRule() {}, appendTable: () => tabla,
        };
        return { getBody: () => body, saveAndClose() {}, getId: () => 'doc' };
      },
    },
    console,
    Date: opciones.Date || Date,
  };
  return { env, propiedades, cache, correos, registro };
}

// Carga un archivo .gs en un contexto aislado con el entorno simulado.
function cargarScript(rutas, planilla, opciones) {
  const e = crearEntorno(planilla, opciones);
  const ctx = vm.createContext(e.env);
  [].concat(rutas).forEach(r => vm.runInContext(fs.readFileSync(r, 'utf8'), ctx, { filename: r }));
  // Las const de nivel superior no quedan como propiedades del contexto; se exponen con un puente.
  const llamar = (codigo) => vm.runInContext(codigo, ctx);
  return Object.assign(e, { ctx, llamar });
}

module.exports = { Planilla, Hoja, cargarScript, convertir };
