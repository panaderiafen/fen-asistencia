// ============================================================
//  fën asistencia — Apps Script API v5.0.1  (2026-10-01)
//
//  Implementar como App web: ejecutar como Yo, acceso "Cualquier persona".
//  El acceso público es necesario para que GitHub Pages pueda llamar al
//  script; la seguridad la pone ESTE código: ninguna acción funciona sin
//  una sesión válida (ver "Quién puede hacer qué", más abajo).
//
//  Cambios respecto a v4:
//   - Las llamadas van por POST con el cuerpo en JSON. Si Google desvía un POST
//     y llega como GET (pasa a veces en navegadores con varias cuentas de
//     Google abiertas), la app lo detecta y reintenta por GET (v5.0.1).
//   - Cada escritura lleva una clave única: si llega dos veces, se ejecuta una.
//   - Panel admin: la contraseña se revisa aquí, nunca en el navegador.
//     Se guarda cifrada en las propiedades del script, no en la planilla.
//   - Tablet: cada dispositivo se autoriza una vez con la contraseña admin.
//   - PIN: se guardan cifrados (con una clave secreta que no está en la
//     planilla) y como texto, así un PIN como 0123 ya no se convierte en 123.
//     5 intentos fallidos bloquean a esa persona por 10 minutos.
//   - Marcar entrada/salida exige haber ingresado el PIN correcto hace
//     menos de 2 minutos.
//   - Editar un registro guarda el antes y el después en "historial_cambios".
//     Nada se borra.
//   - Bloqueo (LockService) en todas las escrituras.
//
//  Instalación (una vez): ver README.md → función instalarSeguridad().
// ============================================================

const VERSION = '5.0.1';

const SESION_ADMIN_DIAS   = 30;    // cuánto dura la sesión del panel en un dispositivo
const SESION_TABLET_DIAS  = 400;   // la tablet queda autorizada ~1 año
const PIN_TOKEN_SEG       = 120;   // tiempo para marcar después de ingresar el PIN
const MAX_INTENTOS        = 5;     // intentos fallidos antes de bloquear
const BLOQUEO_PIN_SEG     = 600;   // 10 min de bloqueo por persona
const BLOQUEO_ADMIN_SEG   = 900;   // 15 min de bloqueo del panel
const CORREO_ADMIN        = 'emmanuel.vepal@gmail.com';

// Columnas de "trabajadores" (base 0)
const T = { correo: 0, nombre: 1, tipo: 2, horasSemana: 3, valorHora: 4, activo: 5, admin: 6, pin: 7, dias: 8 };
// Columnas de "registros" (base 0)
const R = { id: 0, correo: 1, nombre: 2, fecha: 3, entrada: 4, salida: 5, jornada: 6, horas: 7, obs: 8, ingresadoPor: 9 };

// ── Quién puede hacer qué ─────────────────────────────────
//   publico : no requiere sesión
//   equipo  : tablet autorizada o panel admin
//   pin     : además requiere el permiso que entrega verifyPin
//   admin   : solo el panel admin
const ACCIONES = {
  ping:                 { nivel: 'publico', fn: () => ({ ok: true, version: VERSION }) },
  loginAdmin:           { nivel: 'publico', fn: loginAdmin },
  autorizarDispositivo: { nivel: 'publico', fn: autorizarDispositivo },

  getWorkers:           { nivel: 'equipo',  fn: getWorkers },
  verifyPin:            { nivel: 'equipo',  fn: verifyPin },

  getOpenShift:         { nivel: 'pin',     fn: (p, ses) => getOpenShift(p._email) },
  checkIn:              { nivel: 'pin',     fn: checkIn,         escribe: true },
  checkOut:             { nivel: 'pin',     fn: checkOut,        escribe: true },
  solicitarEstado:      { nivel: 'pin',     fn: solicitarEstado },

  adminDatos:           { nivel: 'admin',   fn: adminDatos },
  getRegistros:         { nivel: 'admin',   fn: getRegistros },
  editarRegistro:       { nivel: 'admin',   fn: editarRegistro,  escribe: true },
  agregarRegistro:      { nivel: 'admin',   fn: agregarRegistro, escribe: true },
  agregarBono:          { nivel: 'admin',   fn: agregarBono,     escribe: true },
  setPin:               { nivel: 'admin',   fn: setPin,          escribe: true },
  setDiasLaborales:     { nivel: 'admin',   fn: setDiasLaborales, escribe: true },
  cambiarClaveAdmin:    { nivel: 'admin',   fn: cambiarClaveAdmin, escribe: true },
  listarDispositivos:   { nivel: 'admin',   fn: listarDispositivos },
  revocarDispositivo:   { nivel: 'admin',   fn: revocarDispositivo, escribe: true },
  logout:               { nivel: 'admin',   fn: logout },
};

function doGet(e) {
  const prm = (e && e.parameter) || {};
  if (prm.action === 'ping') return jsonResponse({ ok: true, version: VERSION });
  // Respaldo: la app usa POST, pero si Google convirtió el POST en GET, la app
  // reintenta mandando el mismo JSON en el parámetro "p". Las acciones sueltas
  // en la URL (como en v4) siguen sin aceptarse.
  if (prm.p) {
    let datos;
    try { datos = JSON.parse(prm.p); } catch (err) { return jsonResponse({ error: 'Solicitud inválida', code: 'formato' }); }
    return jsonResponse(despachar(datos));
  }
  return jsonResponse({ error: 'Solicitud sin datos: la app reintentará.', code: 'version' });
}

function doPost(e) {
  let p = {};
  try {
    p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonResponse({ error: 'Solicitud inválida', code: 'formato' });
  }
  return jsonResponse(despachar(p));
}

function despachar(p) {
  const def = ACCIONES[p.action];
  if (!def) return { error: 'Acción no reconocida: ' + p.action, code: 'accion' };

  try {
    let ses = null;
    if (def.nivel !== 'publico') {
      ses = leerSesion(p.token);
      if (!ses) return { error: 'Sesión vencida o dispositivo no autorizado.', code: 'sesion' };
      if (def.nivel === 'admin' && ses.rol !== 'admin') {
        return { error: 'Solo el administrador puede hacer esto.', code: 'permiso' };
      }
      if (def.nivel === 'pin') {
        const email = leerPinToken(p.pinToken);
        if (!email) return { error: 'Vuelve a ingresar tu PIN.', code: 'pin' };
        p._email = email;
      }
    }

    if (!def.escribe) return def.fn(p, ses);

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return { error: 'El sistema está ocupado, intenta de nuevo en unos segundos.', code: 'ocupado' };
    try {
      // Una misma escritura (misma clave "idem") nunca se ejecuta dos veces:
      // si ya se hizo, se devuelve el mismo resultado.
      const idem = typeof p.idem === 'string' && /^[a-z0-9-]{8,64}$/i.test(p.idem) ? 'idem_' + p.idem : null;
      if (idem) {
        const previo = cache().get(idem);
        if (previo) return JSON.parse(previo);
      }
      const r = def.fn(p, ses);
      if (idem) cache().put(idem, JSON.stringify(r), 600);
      return r;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { error: String(err && err.message || err) };
  }
}

// ═══════════════════════════════════════════════════════════
//  Sesiones, claves y PIN
// ═══════════════════════════════════════════════════════════

function props() { return PropertiesService.getScriptProperties(); }
function cache() { return CacheService.getScriptCache(); }

function sha256Hex(texto) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function tokenAleatorio() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function pepper() {
  const v = props().getProperty('PEPPER');
  if (!v) throw new Error('Falta instalar la seguridad: ejecuta instalarSeguridad() una vez desde el editor.');
  return v;
}

// Contraseña admin: sal + 500 rondas de SHA-256 con la clave secreta (pepper).
function hashClave(clave, sal) {
  let h = sal + '|' + clave;
  const pep = pepper();
  for (let i = 0; i < 500; i++) h = sha256Hex(pep + h);
  return h;
}

function claveCorrecta(clave) {
  const guardado = props().getProperty('ADMIN_HASH');
  if (!guardado || typeof clave !== 'string' || !clave) return false;
  const [sal, hash] = guardado.split('$');
  return hashClave(clave, sal) === hash;
}

function guardarClave(clave) {
  const sal = tokenAleatorio().slice(0, 16);
  props().setProperty('ADMIN_HASH', sal + '$' + hashClave(clave, sal));
}

// Bloqueo por intentos fallidos (se guarda en caché: se limpia solo).
function estaBloqueado(clave) {
  return Number(cache().get('bloq_' + clave) || 0) >= MAX_INTENTOS;
}
function registrarFallo(clave, segundos) {
  const n = Number(cache().get('bloq_' + clave) || 0) + 1;
  cache().put('bloq_' + clave, String(n), segundos);
  return MAX_INTENTOS - n;
}
function limpiarFallos(clave) { cache().remove('bloq_' + clave); }

function crearSesion(rol, nombre, dias) {
  const token = tokenAleatorio();
  const id = sha256Hex(token).slice(0, 24);
  const ses = { id, rol, nombre: nombre || '', creada: new Date().toISOString(),
                vence: Date.now() + dias * 86400000 };
  props().setProperty('SES_' + id, JSON.stringify(ses));
  limpiarSesionesVencidas();
  return token;
}

// Borra sesiones vencidas para que no se acumulen en las propiedades del script.
function limpiarSesionesVencidas() {
  const todas = props().getProperties();
  Object.keys(todas).forEach(k => {
    if (k.indexOf('SES_') !== 0) return;
    try { if (JSON.parse(todas[k]).vence < Date.now()) props().deleteProperty(k); }
    catch (e) { props().deleteProperty(k); }
  });
}

function leerSesion(token) {
  if (!token || typeof token !== 'string') return null;
  const id = sha256Hex(token).slice(0, 24);
  const raw = props().getProperty('SES_' + id);
  if (!raw) return null;
  const ses = JSON.parse(raw);
  if (Date.now() > ses.vence) { props().deleteProperty('SES_' + id); return null; }
  return ses;
}

function loginAdmin(p) {
  if (estaBloqueado('admin')) return { error: 'Demasiados intentos. Espera 15 minutos.', code: 'bloqueado' };
  if (!claveCorrecta(p.password)) {
    const quedan = registrarFallo('admin', BLOQUEO_ADMIN_SEG);
    return { error: quedan > 0 ? 'Clave incorrecta.' : 'Demasiados intentos. Espera 15 minutos.', code: 'clave' };
  }
  limpiarFallos('admin');
  return { success: true, token: crearSesion('admin', p.dispositivo || 'panel', SESION_ADMIN_DIAS) };
}

function autorizarDispositivo(p) {
  if (estaBloqueado('admin')) return { error: 'Demasiados intentos. Espera 15 minutos.', code: 'bloqueado' };
  if (!claveCorrecta(p.password)) {
    registrarFallo('admin', BLOQUEO_ADMIN_SEG);
    return { error: 'Clave incorrecta.', code: 'clave' };
  }
  limpiarFallos('admin');
  const nombre = String(p.nombre || 'tablet').slice(0, 40);
  return { success: true, token: crearSesion('tablet', nombre, SESION_TABLET_DIAS) };
}

function logout(p) {
  const id = sha256Hex(p.token).slice(0, 24);
  props().deleteProperty('SES_' + id);
  return { success: true };
}

function cambiarClaveAdmin(p) {
  if (!claveCorrecta(p.actual)) return { error: 'La clave actual no es correcta.', code: 'clave' };
  const nueva = String(p.nueva || '');
  if (nueva.length < 10) return { error: 'La clave nueva debe tener al menos 10 caracteres.' };
  guardarClave(nueva);
  return { success: true };
}

function listarDispositivos(p, ses) {
  const todas = props().getProperties();
  const lista = Object.keys(todas).filter(k => k.indexOf('SES_') === 0).map(k => {
    const s = JSON.parse(todas[k]);
    return { id: s.id, rol: s.rol, nombre: s.nombre, creada: s.creada,
             vence: new Date(s.vence).toISOString(), estaSesion: s.id === ses.id };
  }).filter(s => new Date(s.vence).getTime() > Date.now());
  lista.sort((a, b) => a.creada < b.creada ? 1 : -1);
  return { dispositivos: lista };
}

function revocarDispositivo(p) {
  if (!/^[0-9a-f]{24}$/.test(String(p.id || ''))) return { error: 'Dispositivo inválido' };
  props().deleteProperty('SES_' + p.id);
  return { success: true };
}

// PIN: "h1$<sal>$<hash>" guardado como texto en la columna H.
function hashPin(pin, sal) { return sha256Hex(pepper() + '|' + sal + '|' + pin); }
function pinCifrado(pin) {
  const sal = tokenAleatorio().slice(0, 12);
  return 'h1$' + sal + '$' + hashPin(pin, sal);
}
function pinCoincide(guardado, pin) {
  const g = String(guardado);
  if (g.indexOf('h1$') !== 0) return false; // sin cifrar: debe pasar por instalarSeguridad()
  const partes = g.split('$');
  return hashPin(pin, partes[1]) === partes[2];
}

function leerPinToken(t) {
  if (!t || typeof t !== 'string') return null;
  return cache().get('pt_' + t);
}

function verifyPin(p) {
  const email = String(p.email || '');
  const pin = String(p.pin || '');
  if (!/^\d{4}$/.test(pin)) return { error: 'El PIN tiene 4 dígitos.' };
  if (estaBloqueado('pin_' + email)) return { error: 'Demasiados intentos. Espera 10 minutos o avisa al administrador.', code: 'bloqueado' };

  const fila = buscarTrabajador(email);
  if (!fila) return { error: 'Trabajador no encontrado' };
  const guardado = fila.valores[T.pin];
  if (guardado === '' || guardado === null) return { error: 'Este trabajador no tiene PIN asignado. Contacta al administrador.' };

  if (!pinCoincide(guardado, pin)) {
    const quedan = registrarFallo('pin_' + email, BLOQUEO_PIN_SEG);
    return { error: quedan > 0 ? 'PIN incorrecto' : 'Demasiados intentos. Espera 10 minutos o avisa al administrador.',
             code: quedan > 0 ? 'pin_incorrecto' : 'bloqueado' };
  }
  limpiarFallos('pin_' + email);
  const pinToken = tokenAleatorio();
  cache().put('pt_' + pinToken, email, PIN_TOKEN_SEG);
  return { success: true, pinToken };
}

function setPin(p) {
  const pin = String(p.pin || '');
  if (!/^\d{4}$/.test(pin)) return { error: 'El PIN debe tener 4 dígitos.' };
  const fila = buscarTrabajador(p.email);
  if (!fila) return { error: 'Trabajador no encontrado' };
  const celda = hoja('trabajadores').getRange(fila.numero, T.pin + 1);
  celda.setNumberFormat('@');
  celda.setValue(pinCifrado(pin));
  limpiarFallos('pin_' + p.email);
  return { success: true };
}

// ═══════════════════════════════════════════════════════════
//  Fichar
// ═══════════════════════════════════════════════════════════

function hoja(nombre) {
  const h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h) throw new Error('No existe la hoja "' + nombre + '"');
  return h;
}

function buscarTrabajador(email) {
  const data = hoja('trabajadores').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][T.correo]) === String(email)) return { numero: i + 1, valores: data[i] };
  }
  return null;
}

function checkIn(p) {
  const email = p._email;
  const trab = buscarTrabajador(email);
  if (!trab) return { error: 'Trabajador no encontrado' };
  const open = getOpenShift(email);
  if (open && open.id) return { error: 'Ya tienes un turno abierto', openShift: open };
  const now = new Date();
  const id = now.getTime().toString();
  const fecha = formatDate(now);
  const entrada = formatTime(now);
  const jornada = p.jornada === 'feriado' ? 'feriado' : 'ordinaria';
  hoja('registros').appendRow([id, email, String(trab.valores[T.nombre]), fecha, entrada, '', jornada, '', '', 'trabajador']);
  cache().remove('pt_' + p.pinToken);
  return { success: true, id, fecha, entrada };
}

function checkOut(p) {
  const email = p._email;
  const sheet = hoja('registros');
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  let entrada = '';
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][R.correo]) === email && !String(data[i][R.salida])) {
      rowIndex = i + 1;
      const v = data[i][R.entrada];
      entrada = typeof v === 'string' ? v : formatTime(v);
      break;
    }
  }
  if (rowIndex === -1) return { error: 'No se encontró turno abierto' };
  const salida = formatTime(new Date());
  const horas = calcHoras(entrada, salida);
  sheet.getRange(rowIndex, R.salida + 1).setValue(salida);
  sheet.getRange(rowIndex, R.horas + 1).setValue(horas.toFixed(2));
  cache().remove('pt_' + p.pinToken);
  return { success: true, salida, horas: horas.toFixed(2) };
}

function getOpenShift(email) {
  const data = hoja('registros').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][R.correo]) === email && String(data[i][R.entrada]) && !String(data[i][R.salida])) {
      return {
        id:          String(data[i][R.id]),
        email:       String(data[i][R.correo]),
        nombre:      String(data[i][R.nombre]),
        fecha:       formatDate(data[i][R.fecha]),
        entrada:     formatTime(data[i][R.entrada]),
        tipoJornada: String(data[i][R.jornada]) || 'ordinaria',
      };
    }
  }
  return { id: null };
}

// Lista para la tablet: sin valor hora ni PIN.
function getWorkers() {
  const dataTrab = hoja('trabajadores').getDataRange().getValues();
  const dataReg = hoja('registros').getDataRange().getValues();
  const abiertos = {};
  for (let i = 1; i < dataReg.length; i++) {
    const email = String(dataReg[i][R.correo]);
    if (email && dataReg[i][R.entrada] !== '' && !String(dataReg[i][R.salida])) abiertos[email] = formatTime(dataReg[i][R.entrada]);
  }
  const workers = [];
  for (let i = 1; i < dataTrab.length; i++) {
    if (dataTrab[i][T.correo] && String(dataTrab[i][T.activo]) !== 'false') {
      const email = String(dataTrab[i][T.correo]);
      workers.push({
        email,
        nombre:   String(dataTrab[i][T.nombre]),
        tipo:     String(dataTrab[i][T.tipo]),
        tienePin: String(dataTrab[i][T.pin]) !== '',
        entrada:  abiertos[email] || null,
      });
    }
  }
  return { workers };
}

// ═══════════════════════════════════════════════════════════
//  Panel admin
// ═══════════════════════════════════════════════════════════

// Reemplaza la lectura directa con clave de API que hacía el panel en v4.
function adminDatos() {
  const trab = hoja('trabajadores').getDataRange().getValues();
  const workers = [];
  for (let i = 1; i < trab.length; i++) {
    if (!trab[i][T.correo]) continue;
    workers.push({
      email:         String(trab[i][T.correo]),
      nombre:        String(trab[i][T.nombre]),
      tipo:          String(trab[i][T.tipo]),
      horasSemana:   parseFloat(trab[i][T.horasSemana]) || 0,
      valorHora:     parseFloat(trab[i][T.valorHora]) || 0,
      activo:        String(trab[i][T.activo]) !== 'false',
      admin:         String(trab[i][T.admin]) === 'true',
      tienePin:      String(trab[i][T.pin]) !== '',
      diasLaborales: trab[i][T.dias] ? String(trab[i][T.dias]) : 'L-V',
    });
  }
  const registros = getRegistros({}).registros.map(r => Object.assign({}, r, {
    horasTrabajadas: parseFloat(r.horasTrabajadas) || 0,
  }));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const feriados = [];
  const hf = ss.getSheetByName('feriados');
  if (hf) hf.getDataRange().getValues().slice(1).forEach(f => {
    if (f[0] !== '') feriados.push({ fecha: formatDate(f[0]), descripcion: String(f[1] || '') });
  });
  const bonos = [];
  const hb = ss.getSheetByName('bonos');
  if (hb) hb.getDataRange().getValues().slice(1).forEach(b => {
    if (b[0] === '' && b[1] === '') return;
    bonos.push({ fecha: formatDate(b[0]), email: String(b[1]), nombre: String(b[2]),
                 monto: parseFloat(b[3]) || 0, concepto: String(b[4] || ''), agregadoPor: String(b[5] || '') });
  });
  return { workers, registros, feriados, bonos, version: VERSION };
}

function getRegistros(params) {
  const data = hoja('registros').getDataRange().getValues();
  let registros = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][R.id] === '' || data[i][R.id] === null) continue;
    if (params.email && String(data[i][R.correo]) !== params.email) continue;
    const salidaVal = data[i][R.salida];
    registros.push({
      id:              String(data[i][R.id]),
      email:           String(data[i][R.correo]),
      nombre:          String(data[i][R.nombre]),
      fecha:           formatDate(data[i][R.fecha]),
      entrada:         formatTime(data[i][R.entrada]),
      salida:          salidaVal !== '' ? formatTime(salidaVal) : '',
      tipoJornada:     String(data[i][R.jornada]) || 'ordinaria',
      horasTrabajadas: String(data[i][R.horas]),
      ingresadoPor:    data[i][R.ingresadoPor] ? String(data[i][R.ingresadoPor]) : 'trabajador',
    });
  }
  if (params.mes && params.anio) {
    const prefix = parseInt(params.anio, 10) + '-' + pad(parseInt(params.mes, 10));
    registros = registros.filter(r => r.fecha && r.fecha.indexOf(prefix) === 0);
  }
  registros.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  return { registros };
}

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function editarRegistro(params, ses) {
  const sheet = hoja('registros');
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][R.id]) === String(params.id)) { rowIndex = i + 1; break; }
  }
  if (rowIndex === -1) return { error: 'Registro no encontrado' };
  if (!HORA_RE.test(params.entrada || '')) return { error: 'Hora de entrada inválida' };
  if (params.salida && !HORA_RE.test(params.salida)) return { error: 'Hora de salida inválida' };

  const fila = data[rowIndex - 1];
  const antes = {
    entrada: formatTime(fila[R.entrada]),
    salida: fila[R.salida] !== '' ? formatTime(fila[R.salida]) : '',
    jornada: String(fila[R.jornada]),
    horas: String(fila[R.horas]),
  };
  const horas = params.salida ? calcHoras(params.entrada, params.salida).toFixed(2) : '';
  const despues = { entrada: params.entrada, salida: params.salida || '',
                    jornada: params.jornada === 'feriado' ? 'feriado' : 'ordinaria', horas };
  const now = new Date();
  const nota = 'editado por admin - ' + formatDate(now) + ' ' + formatTime(now);

  registrarHistorial('editarRegistro', params.id, antes, despues, ses);
  sheet.getRange(rowIndex, R.entrada + 1).setValue(despues.entrada);
  sheet.getRange(rowIndex, R.salida + 1).setValue(despues.salida);
  sheet.getRange(rowIndex, R.jornada + 1).setValue(despues.jornada);
  sheet.getRange(rowIndex, R.horas + 1).setValue(horas);
  sheet.getRange(rowIndex, R.ingresadoPor + 1).setValue(nota);
  return { success: true, horas };
}

function agregarRegistro(params, ses) {
  const trab = buscarTrabajador(params.email);
  if (!trab) return { error: 'Trabajador no encontrado' };
  if (!FECHA_RE.test(params.fecha || '')) return { error: 'Fecha inválida' };
  if (!HORA_RE.test(params.entrada || '')) return { error: 'Hora de entrada inválida' };
  if (params.salida && !HORA_RE.test(params.salida)) return { error: 'Hora de salida inválida' };
  const id = Date.now().toString();
  const horas = params.salida ? calcHoras(params.entrada, params.salida).toFixed(2) : '';
  const now = new Date();
  const por = 'admin - ' + formatDate(now) + ' ' + formatTime(now);
  const jornada = params.jornada === 'feriado' ? 'feriado' : 'ordinaria';
  hoja('registros').appendRow([id, params.email, String(trab.valores[T.nombre]), params.fecha,
                               params.entrada, params.salida || '', jornada, horas, '', por]);
  registrarHistorial('agregarRegistro', id, {}, { fecha: params.fecha, entrada: params.entrada,
                     salida: params.salida || '', jornada }, ses);
  return { success: true, id, horas };
}

function agregarBono(params, ses) {
  const sheet = hoja('bonos');
  const trab = buscarTrabajador(params.email);
  if (!trab) return { error: 'Trabajador no encontrado' };
  const monto = parseFloat(params.monto);
  if (!(monto > 0)) return { error: 'Monto inválido' };
  if (!FECHA_RE.test(params.fecha || '')) return { error: 'Fecha inválida' };
  sheet.appendRow([params.fecha, params.email, String(trab.valores[T.nombre]), monto,
                   String(params.concepto || '').slice(0, 200), 'admin']);
  return { success: true };
}

function setDiasLaborales(params) {
  const fila = buscarTrabajador(params.email);
  if (!fila) return { error: 'Trabajador no encontrado' };
  const valor = params.dias === 'L-S' ? 'L-S' : 'L-V';
  hoja('trabajadores').getRange(fila.numero, T.dias + 1).setValue(valor);
  return { success: true, dias: valor };
}

function registrarHistorial(accion, registroId, antes, despues, ses) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let h = ss.getSheetByName('historial_cambios');
  if (!h) {
    h = ss.insertSheet('historial_cambios');
    h.appendRow(['fecha', 'accion', 'registroId', 'antes', 'despues', 'por']);
  }
  h.appendRow([new Date(), accion, String(registroId), JSON.stringify(antes), JSON.stringify(despues),
               ses ? ses.rol + ':' + ses.nombre : '']);
}

// ═══════════════════════════════════════════════════════════
//  Solicitud de estado de horas (sin cambios de cálculo respecto a v4)
// ═══════════════════════════════════════════════════════════

function solicitarEstado(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const email = params._email;
  const trab = buscarTrabajador(email);
  if (!trab) return { error: 'Trabajador no encontrado' };
  const t = trab.valores;
  const worker = {
    email, nombre: String(t[T.nombre]), tipo: String(t[T.tipo]),
    horasSemana: parseFloat(t[T.horasSemana]) || 0,
    valorHora: parseFloat(t[T.valorHora]) || 0,
    diasLaborales: t[T.dias] ? String(t[T.dias]) : 'L-V',
  };

  const now = new Date();
  const mes = now.getMonth() + 1;
  const anio = now.getFullYear();
  const desde = anio + '-' + pad(mes) + '-01';
  const hasta = anio + '-' + pad(mes) + '-' + pad(new Date(anio, mes, 0).getDate());
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const nombreMes = MESES[mes - 1];

  const regData = hoja('registros').getDataRange().getValues();
  const registros = [];
  let totalHoras = 0;
  for (let i = 1; i < regData.length; i++) {
    if (String(regData[i][R.correo]) !== email) continue;
    const fecha = formatDate(regData[i][R.fecha]);
    if (!fecha || fecha < desde || fecha > hasta) continue;
    if (regData[i][R.salida] === '') continue;
    const horas = parseFloat(regData[i][R.horas]) || 0;
    totalHoras += horas;
    registros.push({ fecha, entrada: formatTime(regData[i][R.entrada]), salida: formatTime(regData[i][R.salida]),
                     jornada: String(regData[i][R.jornada]) || 'ordinaria', horas });
  }

  const semanas = {};
  registros.forEach(r => { const wk = getWeekKey(r.fecha); semanas[wk] = (semanas[wk] || 0) + r.horas; });
  let totalExtras = 0;
  Object.keys(semanas).forEach(wk => { if (semanas[wk] > worker.horasSemana) totalExtras += semanas[wk] - worker.horasSemana; });
  const horasOrdinarias = totalHoras - totalExtras;
  const feriadosDetalle = registros.filter(r => r.jornada === 'feriado').map(r => ({ fecha: r.fecha, horas: r.horas }));
  const horasFeriado = feriadosDetalle.reduce((s, f) => s + f.horas, 0);

  let inasistencias = [];
  if (worker.tipo !== 'BHE') {
    const feriadosFechas = obtenerFeriados(ss);
    const conRegistro = {};
    registros.forEach(r => { conRegistro[r.fecha] = true; });
    inasistencias = diasEsperados(worker.diasLaborales, desde, hasta)
      .filter(f => !conRegistro[f] && feriadosFechas.indexOf(f) === -1);
  }
  const bonosDetalle = obtenerBonosDelMes(ss, email, desde, hasta);
  const bonosTotal = bonosDetalle.reduce((s, b) => s + b.monto, 0);

  const doc = DocumentApp.create('fen Estado de horas ' + worker.nombre + ' ' + nombreMes + ' ' + anio);
  const body = doc.getBody();
  body.setMarginTop(40).setMarginBottom(40).setMarginLeft(50).setMarginRight(50);
  try {
    const img = body.appendImage(DriveApp.getFileById('1cI24gpM5l1NPde74IiC5h6btZBnts2fV').getBlob());
    img.setWidth(100).setHeight(100);
  } catch (e) {
    body.appendParagraph('fen').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  }
  const titulo = body.appendParagraph('Estado de horas - ' + worker.nombre);
  titulo.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  titulo.editAsText().setFontSize(16).setBold(true);
  body.appendParagraph(nombreMes + ' ' + anio + '  -  ' + (worker.tipo === 'BHE' ? 'Boleta de Honorarios' : 'Contrato') +
                       '  -  Emitido: ' + formatDate(now) + ' ' + formatTime(now))
    .editAsText().setFontSize(10).setForegroundColor('#7a6f65');
  body.appendHorizontalRule();
  body.appendParagraph('RESUMEN').editAsText().setBold(true).setFontSize(11);
  const fmt = n => '$' + Math.round(n).toLocaleString('es-CL');

  if (worker.tipo === 'BHE') {
    const bruto = Math.round(totalHoras * worker.valorHora);
    const descuento = Math.round(bruto * 0.1525);
    const tabla = body.appendTable([
      ['Total horas', totalHoras.toFixed(2) + ' h'], ['Valor hora', fmt(worker.valorHora)],
      ['Bruto', fmt(bruto)], ['Descuento 15,25%', fmt(descuento)], ['Liquido', fmt(bruto - descuento)],
    ]);
    tabla.setBorderWidth(0);
    tabla.getRow(4).editAsText().setBold(true).setFontSize(13);
  } else {
    const filas = [
      ['Horas contrato / semana', worker.horasSemana + ' h'], ['Total horas trabajadas', totalHoras.toFixed(2) + ' h'],
      ['Horas ordinarias', horasOrdinarias.toFixed(2) + ' h'], ['Horas extras', totalExtras.toFixed(2) + ' h'],
      ['Horas trabajadas en feriado', horasFeriado.toFixed(2) + ' h'], ['Inasistencias', String(inasistencias.length)],
    ];
    if (bonosDetalle.length) filas.push(['Bonos del mes', fmt(bonosTotal)]);
    const tabla = body.appendTable(filas);
    tabla.setBorderWidth(0);
    tabla.getRow(3).editAsText().setBold(true);
  }
  if (feriadosDetalle.length) {
    body.appendParagraph('');
    body.appendParagraph('Feriados trabajados (valor distinto): ' +
      feriadosDetalle.map(f => f.fecha + ' (' + f.horas.toFixed(2) + ' h)').join(', '))
      .editAsText().setFontSize(9).setForegroundColor('#b43c1d');
  }
  if (inasistencias.length) {
    body.appendParagraph('Inasistencias: ' + inasistencias.join(', ')).editAsText().setFontSize(9).setForegroundColor('#b43c1d');
  }
  if (bonosDetalle.length) {
    body.appendParagraph('Bonos: ' + bonosDetalle.map(b => b.fecha + ' · ' + fmt(b.monto) + ' · ' + b.concepto).join(', '))
      .editAsText().setFontSize(9).setForegroundColor('#ba7517');
  }
  body.appendParagraph('');
  body.appendHorizontalRule();
  body.appendParagraph('DETALLE DIA A DIA').editAsText().setBold(true).setFontSize(11);
  if (!registros.length) {
    body.appendParagraph('Sin registros para este periodo.').editAsText().setForegroundColor('#999999');
  } else {
    const headers = worker.tipo === 'BHE'
      ? [['Fecha','Entrada','Salida','Jornada','Horas','Valor hora','Monto']]
      : [['Fecha','Entrada','Salida','Jornada','Horas']];
    const filas = registros.map(r => {
      if (worker.tipo === 'BHE') {
        const esFeriado = r.jornada === 'feriado';
        const vh = esFeriado ? worker.valorHora * 1.5 : worker.valorHora;
        return [r.fecha, r.entrada, r.salida, esFeriado ? 'Feriado x1.5' : 'Ordinaria', r.horas.toFixed(2), fmt(vh), fmt(Math.round(r.horas * vh))];
      }
      return [r.fecha, r.entrada, r.salida, r.jornada, r.horas.toFixed(2)];
    });
    const tabla = body.appendTable(headers.concat(filas));
    const hr = tabla.getRow(0);
    for (let c = 0; c < hr.getNumCells(); c++) {
      hr.getCell(c).editAsText().setBold(true).setForegroundColor('#ffffff');
      hr.getCell(c).setBackgroundColor('#28231e');
    }
  }
  body.appendParagraph('');
  body.appendParagraph('Generado automaticamente por fen asistencia.').editAsText().setFontSize(8).setForegroundColor('#aaaaaa').setItalic(true);
  doc.saveAndClose();
  const docFile = DriveApp.getFileById(doc.getId());
  const pdf = docFile.getAs('application/pdf').setName('fen_estado_' + worker.nombre.replace(/ /g, '_') + '_' + nombreMes + '_' + anio + '.pdf');
  MailApp.sendEmail(CORREO_ADMIN, '[fen] Estado de horas - ' + worker.nombre + ' - ' + nombreMes + ' ' + anio,
    'Hola,\n\n' + worker.nombre + ' ha solicitado su estado de horas correspondiente a ' + nombreMes + ' ' + anio +
    '.\n\nEncontrarás el detalle completo en el PDF adjunto.\n\n- fen asistencia', { attachments: [pdf] });
  docFile.setTrashed(true); // el documento temporal; el PDF queda en el correo
  return { success: true, nombre: worker.nombre, mes: nombreMes, anio };
}

function obtenerFeriados(ss) {
  const sheet = ss.getSheetByName('feriados');
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1).filter(f => f[0] !== '').map(f => formatDate(f[0]));
}

function obtenerBonosDelMes(ss, email, desde, hasta) {
  const sheet = ss.getSheetByName('bonos');
  if (!sheet) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(b => b[0] !== '' && String(b[1]) === email)
    .map(b => ({ fecha: formatDate(b[0]), monto: parseFloat(b[3]) || 0, concepto: String(b[4] || '') }))
    .filter(b => b.fecha >= desde && b.fecha <= hasta);
}

function diasEsperados(diasLaborales, desde, hasta) {
  const hoy = formatDate(new Date());
  const fin = hasta < hoy ? hasta : hoy;
  const dias = [];
  const d = new Date(desde + 'T12:00:00');
  const dFin = new Date(fin + 'T12:00:00');
  while (d <= dFin) {
    const dow = d.getDay();
    const laboral = diasLaborales === 'L-S' ? (dow >= 1 && dow <= 6) : (dow >= 1 && dow <= 5);
    if (laboral) dias.push(formatDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

function getWeekKey(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00');
  const dow = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dow);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getFullYear() + '-W' + pad(week);
}

// ── Utils ──────────────────────────────────────────────────

function formatDate(d) {
  if (!(d instanceof Date)) return d === null || d === undefined ? '' : String(d);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function formatTime(d) {
  if (!(d instanceof Date)) return d === null || d === undefined ? '' : String(d);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function pad(n) { return String(n).padStart(2, '0'); }
function calcHoras(entrada, salida) {
  const a = String(entrada).split(':').map(Number);
  const b = String(salida).split(':').map(Number);
  return ((b[0] * 60 + b[1]) - (a[0] * 60 + a[1])) / 60;
}
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════
//  INSTALACIÓN — ejecutar UNA vez desde el editor (Ejecutar ▸ instalarSeguridad)
// ═══════════════════════════════════════════════════════════
//  1. Crea la clave secreta (pepper) en las propiedades del script.
//  2. Crea una contraseña inicial para el panel y la muestra en el
//     "Registro de ejecución". Cámbiala después desde el panel.
//  3. Cifra los PIN que hoy están a la vista en la columna H. Un PIN que
//     Sheets guardó como número (0123 → 123) se completa a 4 dígitos.
//  4. Deja la columna H como texto y crea la hoja "historial_cambios".
//  Se puede ejecutar de nuevo sin riesgo: lo ya hecho no se repite.
function instalarSeguridad() {
  const p = props();
  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', tokenAleatorio() + tokenAleatorio());

  let claveInicial = null;
  if (!p.getProperty('ADMIN_HASH')) {
    const letras = 'abcdefghjkmnpqrstuvwxyz23456789';
    claveInicial = 'fen-';
    const azar = tokenAleatorio();
    for (let i = 0; i < 12; i++) {
      claveInicial += letras[parseInt(azar.substr(i * 2, 2), 16) % letras.length];
      if (i === 3 || i === 7) claveInicial += '-';
    }
    guardarClave(claveInicial);
  }

  const sh = hoja('trabajadores');
  const data = sh.getDataRange().getValues();
  let cifrados = 0, completados = 0;
  for (let i = 1; i < data.length; i++) {
    const v = data[i][T.pin];
    if (v === '' || v === null) continue;
    let pin = String(v).trim();
    if (pin.indexOf('h1$') === 0) continue;
    if (/^\d{1,3}$/.test(pin)) { pin = pin.padStart(4, '0'); completados++; }
    if (!/^\d{4}$/.test(pin)) { Logger.log('Fila ' + (i + 1) + ': PIN con formato raro, se dejó sin cambiar. Asígnalo de nuevo desde el panel.'); continue; }
    const celda = sh.getRange(i + 1, T.pin + 1);
    celda.setNumberFormat('@');
    celda.setValue(pinCifrado(pin));
    cifrados++;
  }
  sh.getRange(1, T.pin + 1, Math.max(sh.getLastRow(), 2), 1).setNumberFormat('@');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName('historial_cambios')) {
    ss.insertSheet('historial_cambios').appendRow(['fecha', 'accion', 'registroId', 'antes', 'despues', 'por']);
  }

  Logger.log('Seguridad v' + VERSION + ' instalada.');
  Logger.log('PIN cifrados: ' + cifrados + ' (de ellos, ' + completados + ' tenían un 0 inicial perdido y se completaron).');
  if (claveInicial) Logger.log('CONTRASEÑA INICIAL DEL PANEL: ' + claveInicial + '  ← anótala y cámbiala desde el panel.');
  else Logger.log('La contraseña del panel ya existía; no se cambió.');
  return { cifrados, completados, claveInicial };
}

// Si olvidas la contraseña: ejecuta esto desde el editor. Crea una nueva,
// la muestra en el registro y cierra todas las sesiones (tablets incluidas).
function restablecerClaveAdmin() {
  props().deleteProperty('ADMIN_HASH');
  const todas = props().getProperties();
  Object.keys(todas).filter(k => k.indexOf('SES_') === 0).forEach(k => props().deleteProperty(k));
  return instalarSeguridad();
}
