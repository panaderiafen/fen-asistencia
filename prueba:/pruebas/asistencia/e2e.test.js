// Pruebas de navegador de Asistencia v5: tablet y panel admin contra el simulador.
// Ejecutar: NODE_PATH=$(npm root -g) node --test pruebas/asistencia/e2e.test.js
// Deja capturas en pruebas/capturas/asistencia/.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { iniciar } = require('../servidor');
const { planillaAsistencia, hoyISO } = require('./datos');

const CARPETA = path.join(__dirname, '../..');
const CAPTURAS = path.join(__dirname, '../capturas/asistencia');
fs.mkdirSync(CAPTURAS, { recursive: true });

let srv, browser, clave;
const erroresConsola = [];

test.before(async () => {
  srv = await iniciar({
    carpeta: CARPETA,
    gs: path.join(CARPETA, 'Code.gs'),
    crearPlanilla: planillaAsistencia,
    preparar: s => JSON.parse(s.llamar('JSON.stringify(instalarSeguridad())')),
  });
  clave = srv.extra.claveInicial;
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
  srv.server.close();
});

async function nuevaPagina(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => erroresConsola.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) erroresConsola.push(m.text()); });
  return { ctx, page };
}

async function marcarPin(page, pin) {
  for (const d of pin) await page.click(`.num-btn[data-n="${d}"]`);
}

let tabletCtx;

test('tablet: se autoriza una vez, muestra el equipo y no ejecuta HTML de los nombres', async () => {
  const { ctx, page } = await nuevaPagina({ width: 1280, height: 800 });
  tabletCtx = ctx;
  await page.goto(srv.url + '/tablet.html');
  await page.waitForSelector('#screen-autorizar.active');
  await page.screenshot({ path: path.join(CAPTURAS, '01-tablet-autorizar.png') });

  await page.fill('#autorizar-clave', 'clave-mala');
  await page.click('#btn-autorizar');
  await page.waitForFunction(() => document.getElementById('autorizar-error').textContent.includes('incorrecta'));

  await page.fill('#autorizar-clave', clave);
  await page.fill('#autorizar-nombre', 'Tablet Barros Arana');
  await page.click('#btn-autorizar');
  await page.waitForSelector('#screen-workers.active .worker-btn');
  const nombres = await page.$$eval('.worker-btn > span:first-of-type', els => els.map(e => e.textContent));
  assert.ok(nombres.includes('Ana Rojas'));
  assert.ok(!nombres.includes('Ex Trabajador'), 'inactivos no aparecen');
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'el nombre con HTML no se ejecuta');
  assert.ok(nombres.some(n => n.includes('<img')), 'el nombre raro se muestra como texto');
  await page.screenshot({ path: path.join(CAPTURAS, '02-tablet-equipo.png') });

  // Recargar: sigue autorizada
  await page.reload();
  await page.waitForSelector('#screen-workers.active .worker-btn');
});

test('tablet: PIN 0123 funciona, registra salida; PIN malo avisa', async () => {
  const page = tabletCtx.pages()[0];
  await page.click('.worker-btn[data-email="beto@prueba.cl"]');
  await page.waitForSelector('#screen-pin.active');
  await marcarPin(page, '0123');
  await page.waitForSelector('#screen-fichar.active');
  await page.waitForFunction(() => !document.getElementById('btn-salida').disabled);
  await page.screenshot({ path: path.join(CAPTURAS, '03-tablet-fichar.png') });
  await page.click('#btn-salida');
  await page.waitForSelector('#screen-confirm.active');
  assert.match(await page.textContent('#confirm-title'), /Salida registrada/);
  await page.screenshot({ path: path.join(CAPTURAS, '04-tablet-confirmacion.png') });
  await page.waitForSelector('#screen-workers.active', { timeout: 8000 });

  await page.click('.worker-btn[data-email="ana@prueba.cl"]');
  await marcarPin(page, '0000');
  await page.waitForFunction(() => document.getElementById('pin-error').textContent.includes('incorrecto'));
  await page.screenshot({ path: path.join(CAPTURAS, '05-tablet-pin-incorrecto.png') });
  await marcarPin(page, '1234');
  await page.waitForSelector('#screen-fichar.active');
  await page.click('#jornada-feriado');
  await page.waitForFunction(() => !document.getElementById('btn-entrada').disabled);
  await page.click('#btn-entrada');
  await page.waitForSelector('#screen-confirm.active');
  const ultima = srv.planilla.getSheetByName('registros').celdas.at(-1);
  assert.equal(ultima[1], 'ana@prueba.cl');
  assert.equal(ultima[6], 'feriado');
});

test('tablet en celular: la lista se ve completa', async () => {
  const { ctx, page } = await nuevaPagina({ width: 390, height: 844 });
  await page.goto(srv.url + '/tablet.html');
  await page.fill('#autorizar-clave', clave);
  await page.click('#btn-autorizar');
  await page.waitForSelector('#screen-workers.active .worker-btn');
  await page.screenshot({ path: path.join(CAPTURAS, '06-tablet-celular.png') });
  await ctx.close();
});

let adminCtx;

test('panel: clave mala rechazada, clave correcta entra y la sesión persiste', async () => {
  const { ctx, page } = await nuevaPagina({ width: 1440, height: 900 });
  adminCtx = ctx;
  await page.goto(srv.url + '/admin.html');
  await page.screenshot({ path: path.join(CAPTURAS, '07-admin-login.png') });
  await page.fill('#login-password', 'CAMBIA_ESTA_CLAVE');
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#login-error', { state: 'visible' });
  assert.match(await page.textContent('#login-error'), /incorrecta/i);

  await page.fill('#login-password', clave);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#screen-app', { state: 'visible' });
  await page.waitForSelector('#dash-metrics .metric-card');
  await page.screenshot({ path: path.join(CAPTURAS, '08-admin-resumen.png') });
  assert.equal(await page.evaluate(() => window.__xss), undefined);

  await page.reload();
  await page.waitForSelector('#dash-metrics .metric-card');
});

test('panel: editar un registro deja historial', async () => {
  const page = adminCtx.pages()[0];
  await page.click('.tab[data-tab="registros"]');
  // El registro 1001 es de hace dos días: puede caer en el mes anterior.
  const [anio, mes] = hoyISO(-2).split('-');
  await page.selectOption('#reg-mes', String(Number(mes)));
  await page.selectOption('#reg-anio', anio);
  await page.click('#btn-load-registros');
  await page.waitForSelector('#registros-list .record-row');
  await page.screenshot({ path: path.join(CAPTURAS, '09-admin-registros.png') });
  await page.click('#registros-list button[data-id="1001"]');
  await page.fill('#edit-salida', '17:30');
  await page.click('#btn-guardar-edicion');
  await page.waitForFunction(() => document.getElementById('edit-msg').textContent.includes('guardado'));
  const hist = srv.planilla.getSheetByName('historial_cambios').celdas.at(-1);
  assert.equal(String(hist[2]), '1001');
  assert.equal(JSON.parse(hist[3]).salida, '17:00');
  assert.equal(JSON.parse(hist[4]).salida, '17:30');
});

test('panel: contrato, bono, PIN y seguridad', async () => {
  const page = adminCtx.pages()[0];
  await page.click('.tab[data-tab="contrato"]');
  await page.click('#btn-load-contrato');
  await page.waitForSelector('#contrato-results .worker-block');
  await page.screenshot({ path: path.join(CAPTURAS, '10-admin-contrato.png'), fullPage: true });

  await page.selectOption('#bono-worker', 'ana@prueba.cl');
  await page.fill('#bono-monto', '15000');
  await page.fill('#bono-concepto', 'Bono producción');
  await page.click('#btn-agregar-bono');
  await page.waitForFunction(() => document.getElementById('bono-msg').textContent.includes('agregado'));

  await page.click('.tab[data-tab="trabajadores"]');
  await page.waitForSelector('#dispositivos-list .disp-row');
  await page.fill('#pin-input-dani_prueba_cl', '0042');
  await page.click('button[data-email="dani@prueba.cl"][onclick^="guardarPin"]');
  await page.waitForFunction(() => document.getElementById('pin-msg-dani_prueba_cl').textContent.includes('guardado'));
  assert.match(String(srv.planilla.getSheetByName('trabajadores').celdas.find(r => r[0] === 'dani@prueba.cl')[7]), /^h1\$/);

  const filas = await page.$$eval('#dispositivos-list .disp-row', els => els.map(e => e.textContent));
  assert.ok(filas.some(t => t.includes('Tablet Barros Arana')));
  assert.ok(filas.some(t => t.includes('este dispositivo')));
  await page.focus('.section-title .info-i');
  await page.screenshot({ path: path.join(CAPTURAS, '11-admin-trabajadores-seguridad.png'), fullPage: true });

  // Revocar la tablet: al recargarla pide autorización otra vez
  page.once('dialog', d => d.accept());
  const btn = await page.$('#dispositivos-list .disp-row:has-text("Tablet Barros Arana") button');
  await btn.click();
  await page.waitForFunction(() => !document.getElementById('dispositivos-list').textContent.includes('Tablet Barros Arana'));
  const tablet = tabletCtx.pages()[0];
  await tablet.reload();
  await tablet.waitForSelector('#screen-autorizar.active');

  // Cambiar contraseña
  await page.fill('#clave-actual', clave);
  await page.fill('#clave-nueva', 'NuevaClave-Fen-2026');
  await page.fill('#clave-repetir', 'NuevaClave-Fen-2026');
  await page.click('#form-clave button[type=submit]');
  await page.waitForFunction(() => document.getElementById('clave-msg').textContent.includes('cambiada'));
  clave = 'NuevaClave-Fen-2026';
});

test('panel en celular', async () => {
  const { ctx, page } = await nuevaPagina({ width: 390, height: 844 });
  await page.goto(srv.url + '/admin.html');
  await page.fill('#login-password', clave);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#dash-metrics .metric-card');
  await page.screenshot({ path: path.join(CAPTURAS, '12-admin-celular-resumen.png'), fullPage: true });
  await page.click('.tab[data-tab="trabajadores"]');
  await page.waitForSelector('#dispositivos-list .disp-row');
  await page.screenshot({ path: path.join(CAPTURAS, '13-admin-celular-trabajadores.png'), fullPage: true });
  await ctx.close();
});

test('sin errores de JavaScript en ninguna pantalla', () => {
  assert.deepEqual(erroresConsola, []);
});
