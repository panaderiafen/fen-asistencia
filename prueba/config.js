// fën asistencia — configuración pública (v5.0.0)
// Este archivo es público en GitHub Pages: aquí NO va ninguna clave.
// La contraseña del panel y los PIN se revisan en el Apps Script.
const FEN_CONFIG = {
  VERSION:          '5.0.0',
  SPREADSHEET_ID:   '1pJFTUSL47jIKjXmBTiG1xrGNTm2gKPe_hdPCgfiqhBU', // solo para el botón "abrir Google Sheets"; la planilla queda privada
  APPS_SCRIPT_URL:  'https://script.google.com/macros/s/AKfycbyPvMkrMbQbMqgJDCbXqKrpWp7HWeBGoOVV8zLk8xuxLMdGEdLxa9uExTDnRvjVLnY/exec',
  BHE_DESCUENTO:    0.1525,
  FERIADO_MULTIPLICADOR: 1.5,
};

// Llamada al script: siempre POST con JSON (nada viaja en la URL).
// Agrega la sesión guardada en este dispositivo y avisa si venció.
async function fenApi(action, datos = {}, tokenKey) {
  const token = tokenKey ? localStorage.getItem(tokenKey) : null;
  const res = await fetch(FEN_CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    body: JSON.stringify(Object.assign({ action, token }, datos)),
  });
  const data = await res.json();
  if (data && (data.code === 'sesion' || data.code === 'permiso') && tokenKey) {
    localStorage.removeItem(tokenKey);
    const err = new Error(data.error);
    err.code = 'sesion';
    throw err;
  }
  return data;
}

// Escapa texto antes de ponerlo en HTML (nombres, conceptos, notas).
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
