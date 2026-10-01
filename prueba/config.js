// fën asistencia — configuración pública (v5.0.1)
// Este archivo es público en GitHub Pages: aquí NO va ninguna clave.
// La contraseña del panel y los PIN se revisan en el Apps Script.
const FEN_CONFIG = {
  VERSION:          '5.0.1',
  SPREADSHEET_ID:   '1pJFTUSL47jIKjXmBTiG1xrGNTm2gKPe_hdPCgfiqhBU', // solo para el botón "abrir Google Sheets"; la planilla queda privada
  APPS_SCRIPT_URL:  'https://script.google.com/macros/s/AKfycbyPvMkrMbQbMqgJDCbXqKrpWp7HWeBGoOVV8zLk8xuxLMdGEdLxa9uExTDnRvjVLnY/exec',
  BHE_DESCUENTO:    0.1525,
  FERIADO_MULTIPLICADOR: 1.5,
};

// Llamada al script: POST con JSON. Agrega la sesión guardada en este
// dispositivo y una clave única (idem) para que una escritura nunca se repita.
// Si Google desvía el POST y llega como GET (code "version"), reintenta por GET
// con el mismo JSON — la clave idem evita que se registre dos veces.
async function fenApi(action, datos = {}, tokenKey) {
  const token = tokenKey ? localStorage.getItem(tokenKey) : null;
  const idem = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(36).slice(2));
  const cuerpo = JSON.stringify(Object.assign({ action, token, idem }, datos));
  const res = await fetch(FEN_CONFIG.APPS_SCRIPT_URL, { method: 'POST', body: cuerpo });
  let data = await res.json();
  if (data && data.code === 'version') {
    const r2 = await fetch(FEN_CONFIG.APPS_SCRIPT_URL + '?p=' + encodeURIComponent(cuerpo));
    data = await r2.json();
  }
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
