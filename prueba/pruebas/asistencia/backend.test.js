// Pruebas del script de Asistencia v5 contra la planilla simulada.
// Ejecutar: node --test pruebas/asistencia/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { cargarScript } = require('../gas-mock');
const { planillaAsistencia, hoyISO } = require('./datos');

const CODE = path.join(__dirname, '../../Code.gs');

function preparar() {
  const planilla = planillaAsistencia();
  const s = cargarScript(CODE, planilla);
  const api = (obj) => JSON.parse(s.llamar('JSON.stringify(despachar(' + JSON.stringify(obj) + '))'));
  const inst = JSON.parse(s.llamar('JSON.stringify(instalarSeguridad())'));
  return { planilla, s, api, clave: inst.claveInicial, inst };
}

function pinCelda(planilla, email) {
  const f = planilla.getSheetByName('trabajadores').celdas.find(r => r[0] === email);
  return f[7];
}

test('instalarSeguridad cifra los PIN, recupera el 0 inicial y crea la contraseña', () => {
  const { planilla, inst, clave, s } = preparar();
  assert.equal(inst.cifrados, 5, 'cinco trabajadores tenían PIN');
  assert.equal(inst.completados, 1, 'el 0123 guardado como 123 se completa');
  assert.match(clave, /^fen-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  for (const email of ['ana@prueba.cl', 'beto@prueba.cl', 'caro@prueba.cl']) {
    assert.match(String(pinCelda(planilla, email)), /^h1\$/, 'PIN cifrado para ' + email);
  }
  assert.equal(pinCelda(planilla, 'dani@prueba.cl'), '', 'sin PIN sigue sin PIN');
  assert.ok(planilla.getSheetByName('historial_cambios'));
  // Segunda ejecución: no cambia nada ni crea otra clave
  const otra = JSON.parse(s.llamar('JSON.stringify(instalarSeguridad())'));
  assert.equal(otra.cifrados, 0);
  assert.equal(otra.claveInicial, null);
  assert.ok(s.registro.some(l => l.includes('CONTRASEÑA INICIAL')));
});

test('nada funciona sin sesión, y GET no ejecuta acciones', () => {
  const { api, s } = preparar();
  for (const action of ['getWorkers', 'verifyPin', 'checkIn', 'adminDatos', 'setPin', 'editarRegistro', 'agregarBono', 'getRegistros']) {
    const r = api({ action, email: 'ana@prueba.cl', pin: '1234' });
    assert.equal(r.code, 'sesion', action + ' debe rechazarse sin sesión');
  }
  const viaGet = JSON.parse(s.llamar('doGet({parameter:{action:"setPin",email:"ana@prueba.cl",pin:"0000"}}).getContent()'));
  assert.equal(viaGet.code, 'version');
  const ping = JSON.parse(s.llamar('doGet({parameter:{action:"ping"}}).getContent()'));
  assert.equal(ping.version, '5.0.1');
});

test('login admin: clave correcta entrega sesión; 5 errores bloquean', () => {
  const { api, clave } = preparar();
  const ok = api({ action: 'loginAdmin', password: clave });
  assert.ok(ok.success && ok.token);
  assert.ok(api({ action: 'adminDatos', token: ok.token }).workers.length > 0);
  for (let i = 0; i < 5; i++) assert.equal(api({ action: 'loginAdmin', password: 'mala' }).success, undefined);
  const bloq = api({ action: 'loginAdmin', password: clave });
  assert.equal(bloq.code, 'bloqueado', 'incluso con la clave correcta, espera 15 min');
});

test('la tablet no puede hacer acciones de administrador', () => {
  const { api, clave } = preparar();
  const tab = api({ action: 'autorizarDispositivo', password: clave, nombre: 'Tablet local' }).token;
  assert.ok(tab);
  assert.ok(api({ action: 'getWorkers', token: tab }).workers);
  for (const action of ['adminDatos', 'setPin', 'editarRegistro', 'agregarBono', 'agregarRegistro', 'listarDispositivos']) {
    assert.equal(api({ action, token: tab, email: 'ana@prueba.cl', pin: '0000' }).code, 'permiso', action);
  }
});

test('getWorkers para la tablet no expone PIN ni valor hora y oculta inactivos', () => {
  const { api, clave } = preparar();
  const tab = api({ action: 'autorizarDispositivo', password: clave }).token;
  const { workers } = api({ action: 'getWorkers', token: tab });
  assert.equal(workers.find(w => w.email === 'ex@prueba.cl'), undefined);
  const beto = workers.find(w => w.email === 'beto@prueba.cl');
  assert.deepEqual(Object.keys(beto).sort(), ['email', 'entrada', 'nombre', 'tienePin', 'tipo']);
  assert.equal(beto.entrada, '07:30', 'turno abierto visible');
  assert.equal(workers.find(w => w.email === 'dani@prueba.cl').tienePin, false);
});

test('PIN con 0 inicial funciona; marcar exige permiso de PIN', () => {
  const { api, clave, planilla } = preparar();
  const tab = api({ action: 'autorizarDispositivo', password: clave }).token;
  assert.equal(api({ action: 'checkIn', token: tab, jornada: 'ordinaria' }).code, 'pin');
  const v = api({ action: 'verifyPin', token: tab, email: 'beto@prueba.cl', pin: '0123' });
  assert.ok(v.success, 'el PIN 0123 debe funcionar');
  const open = api({ action: 'getOpenShift', token: tab, pinToken: v.pinToken });
  assert.equal(open.entrada, '07:30');
  const out = api({ action: 'checkOut', token: tab, pinToken: v.pinToken });
  assert.ok(out.success);
  // el permiso se usa una vez para marcar
  assert.equal(api({ action: 'checkIn', token: tab, pinToken: v.pinToken }).code, 'pin');
  const filas = planilla.getSheetByName('registros').celdas;
  assert.notEqual(filas[4][5], '', 'salida registrada');
});

test('checkIn registra con el nombre de la planilla, no el que mande el navegador', () => {
  const { api, clave, planilla } = preparar();
  const tab = api({ action: 'autorizarDispositivo', password: clave }).token;
  const v = api({ action: 'verifyPin', token: tab, email: 'ana@prueba.cl', pin: '1234' });
  const r = api({ action: 'checkIn', token: tab, pinToken: v.pinToken, jornada: 'feriado', nombre: 'Otro Nombre', email: 'beto@prueba.cl' });
  assert.ok(r.success);
  const ultima = planilla.getSheetByName('registros').celdas.at(-1);
  assert.equal(ultima[1], 'ana@prueba.cl');
  assert.equal(ultima[2], 'Ana Rojas');
  assert.equal(ultima[6], 'feriado');
  // segundo checkIn con un turno abierto es rechazado
  const v2 = api({ action: 'verifyPin', token: tab, email: 'ana@prueba.cl', pin: '1234' });
  assert.match(api({ action: 'checkIn', token: tab, pinToken: v2.pinToken }).error, /turno abierto/);
});

test('5 PIN incorrectos bloquean a esa persona, no a las demás', () => {
  const { api, clave } = preparar();
  const tab = api({ action: 'autorizarDispositivo', password: clave }).token;
  for (let i = 0; i < 4; i++) assert.equal(api({ action: 'verifyPin', token: tab, email: 'ana@prueba.cl', pin: '0000' }).code, 'pin_incorrecto');
  assert.equal(api({ action: 'verifyPin', token: tab, email: 'ana@prueba.cl', pin: '0000' }).code, 'bloqueado');
  assert.equal(api({ action: 'verifyPin', token: tab, email: 'ana@prueba.cl', pin: '1234' }).code, 'bloqueado');
  assert.ok(api({ action: 'verifyPin', token: tab, email: 'caro@prueba.cl', pin: '9876' }).success);
  // el admin al asignar un PIN nuevo levanta el bloqueo
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  assert.ok(api({ action: 'setPin', token: adm, email: 'ana@prueba.cl', pin: '0007' }).success);
  assert.ok(api({ action: 'verifyPin', token: tab, email: 'ana@prueba.cl', pin: '0007' }).success);
});

test('setPin guarda cifrado y como texto; rechaza PIN mal formados', () => {
  const { api, clave, planilla } = preparar();
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  assert.ok(api({ action: 'setPin', token: adm, email: 'dani@prueba.cl', pin: '0042' }).success);
  assert.match(String(pinCelda(planilla, 'dani@prueba.cl')), /^h1\$/);
  assert.ok(api({ action: 'setPin', token: adm, email: 'dani@prueba.cl', pin: '12a4' }).error);
  assert.ok(api({ action: 'setPin', token: adm, email: 'dani@prueba.cl', pin: '12345' }).error);
});

test('editarRegistro guarda el antes y el después en historial_cambios', () => {
  const { api, clave, planilla } = preparar();
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  const r = api({ action: 'editarRegistro', token: adm, id: '1002', entrada: '08:15', salida: '17:15', jornada: 'ordinaria' });
  assert.equal(r.horas, '9.00');
  const hist = planilla.getSheetByName('historial_cambios').celdas;
  const ultima = hist.at(-1);
  assert.equal(ultima[1], 'editarRegistro');
  assert.equal(String(ultima[2]), '1002');
  assert.deepEqual(JSON.parse(ultima[3]), { entrada: '08:00', salida: '16:30', jornada: 'ordinaria', horas: '8.5' });
  assert.equal(JSON.parse(ultima[4]).entrada, '08:15');
  assert.match(ultima[5], /^admin:/);
  assert.ok(api({ action: 'editarRegistro', token: adm, id: '1002', entrada: '25:00', salida: '' }).error);
  assert.ok(api({ action: 'editarRegistro', token: adm, id: 'no-existe', entrada: '08:00', salida: '' }).error);
});

test('agregarRegistro y agregarBono validan y quedan con el nombre de la planilla', () => {
  const { api, clave, planilla } = preparar();
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  const r = api({ action: 'agregarRegistro', token: adm, email: 'ana@prueba.cl', nombre: 'X', fecha: hoyISO(-3), entrada: '08:00', salida: '12:00', jornada: 'ordinaria' });
  assert.equal(r.horas, '4.00');
  assert.ok(api({ action: 'agregarRegistro', token: adm, email: 'ana@prueba.cl', fecha: 'ayer', entrada: '08:00' }).error);
  assert.ok(api({ action: 'agregarBono', token: adm, email: 'ana@prueba.cl', monto: 15000, concepto: 'Producción', fecha: hoyISO(0) }).success);
  assert.ok(api({ action: 'agregarBono', token: adm, email: 'ana@prueba.cl', monto: -5, concepto: 'x', fecha: hoyISO(0) }).error);
  const bono = planilla.getSheetByName('bonos').celdas.at(-1);
  assert.equal(bono[2], 'Ana Rojas');
  assert.equal(bono[3], 15000);
});

test('adminDatos entrega lo mismo que leía el panel con la clave de API, sin PIN', () => {
  const { api, clave } = preparar();
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  const d = api({ action: 'adminDatos', token: adm });
  const ana = d.workers.find(w => w.email === 'ana@prueba.cl');
  assert.equal(ana.horasSemana, 44);
  assert.equal(ana.activo, true);
  assert.equal('pin' in ana, false);
  assert.equal(d.workers.find(w => w.email === 'ex@prueba.cl').activo, false);
  const reg = d.registros.find(r => r.id === '1002');
  assert.deepEqual([reg.fecha, reg.entrada, reg.salida, reg.horasTrabajadas], [hoyISO(-1), '08:00', '16:30', 8.5]);
  assert.equal(d.feriados[0].fecha, hoyISO(-1));
  assert.ok(JSON.stringify(d).indexOf('h1$') === -1, 'ningún hash de PIN sale del servidor');
});

test('dispositivos: se listan y se pueden revocar', () => {
  const { api, clave } = preparar();
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  const tab = api({ action: 'autorizarDispositivo', password: clave, nombre: 'Tablet Barros Arana' }).token;
  const lista = api({ action: 'listarDispositivos', token: adm }).dispositivos;
  assert.equal(lista.length, 2);
  const t = lista.find(d => d.rol === 'tablet');
  assert.equal(t.nombre, 'Tablet Barros Arana');
  assert.ok(lista.find(d => d.rol === 'admin').estaSesion);
  assert.ok(api({ action: 'revocarDispositivo', token: adm, id: t.id }).success);
  assert.equal(api({ action: 'getWorkers', token: tab }).code, 'sesion');
});

test('cambiar la clave: la anterior deja de servir', () => {
  const { api, clave } = preparar();
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  assert.ok(api({ action: 'cambiarClaveAdmin', token: adm, actual: 'mala', nueva: 'nuevaclave123' }).error);
  assert.ok(api({ action: 'cambiarClaveAdmin', token: adm, actual: clave, nueva: 'corta' }).error);
  assert.ok(api({ action: 'cambiarClaveAdmin', token: adm, actual: clave, nueva: 'NuevaClave-2026' }).success);
  assert.equal(api({ action: 'loginAdmin', password: clave }).code, 'clave');
  assert.ok(api({ action: 'loginAdmin', password: 'NuevaClave-2026' }).success);
});

test('solicitarEstado envía el correo y requiere PIN', () => {
  const { api, clave, s } = preparar();
  const tab = api({ action: 'autorizarDispositivo', password: clave }).token;
  assert.equal(api({ action: 'solicitarEstado', token: tab, email: 'ana@prueba.cl' }).code, 'pin');
  const v = api({ action: 'verifyPin', token: tab, email: 'caro@prueba.cl', pin: '9876' });
  const r = api({ action: 'solicitarEstado', token: tab, pinToken: v.pinToken });
  assert.ok(r.success, JSON.stringify(r));
  assert.equal(s.correos.length, 1);
  assert.match(s.correos[0].asunto, /Carolina Díaz/);
});

test('la sesión vence', () => {
  let t = Date.now();
  const planilla = planillaAsistencia();
  const s = cargarScript(CODE, planilla, {});
  const api = (obj) => JSON.parse(s.llamar('JSON.stringify(despachar(' + JSON.stringify(obj) + '))'));
  const clave = JSON.parse(s.llamar('JSON.stringify(instalarSeguridad())')).claveInicial;
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  // Simula 31 días: se adelanta el vencimiento guardado
  const props = s.propiedades;
  const k = Object.keys(props).find(k => k.startsWith('SES_'));
  const ses = JSON.parse(props[k]); ses.vence = t - 1; props[k] = JSON.stringify(ses);
  assert.equal(api({ action: 'adminDatos', token: adm }).code, 'sesion');
  assert.equal(props[k], undefined, 'la sesión vencida se elimina');
});

test('v5.0.1: si Google convierte el POST en GET, el reintento con ?p= funciona', () => {
  const { s, api, clave } = preparar();
  const tab = api({ action: 'autorizarDispositivo', password: clave }).token;
  const sinDatos = JSON.parse(s.llamar('doGet({parameter:{}}).getContent()'));
  assert.equal(sinDatos.code, 'version');
  const p = JSON.stringify({ action: 'getWorkers', token: tab });
  const r = JSON.parse(s.llamar('doGet({parameter:{p:' + JSON.stringify(p) + '}}).getContent()'));
  assert.ok(r.workers && r.workers.length);
  // por GET también se exige sesión
  const sinSesion = JSON.parse(s.llamar('doGet({parameter:{p:' + JSON.stringify(JSON.stringify({ action: 'adminDatos' })) + '}}).getContent()'));
  assert.equal(sinSesion.code, 'sesion');
});

test('v5.0.1: la misma escritura (misma clave idem) se ejecuta una sola vez', () => {
  const { api, clave, planilla } = preparar();
  const adm = api({ action: 'loginAdmin', password: clave }).token;
  const antes = planilla.getSheetByName('bonos').celdas.length;
  const pedido = { action: 'agregarBono', token: adm, idem: 'prueba-idem-0001', email: 'ana@prueba.cl', monto: 1000, concepto: 'x', fecha: hoyISO(0) };
  assert.ok(api(pedido).success);
  assert.ok(api(pedido).success, 'el reintento responde igual');
  assert.equal(planilla.getSheetByName('bonos').celdas.length, antes + 1, 'pero se guardó una sola vez');
  assert.ok(api(Object.assign({}, pedido, { idem: 'prueba-idem-0002' })).success);
  assert.equal(planilla.getSheetByName('bonos').celdas.length, antes + 2);
});
