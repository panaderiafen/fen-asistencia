// Servidor de prueba: sirve una app de Fën y simula su Apps Script en /exec.
// Lo usan las pruebas de navegador (e2e) de cada app.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { cargarScript } = require('./gas-mock');

function iniciar({ carpeta, gs, crearPlanilla, puerto = 0, preparar }) {
  const planilla = crearPlanilla();
  const s = cargarScript(gs, planilla);
  const extra = preparar ? preparar(s) : {};
  let latencia = 0;

  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
                  '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/exec') {
      let cuerpo = '';
      req.on('data', c => { cuerpo += c; });
      req.on('end', () => {
        const e = req.method === 'POST'
          ? { postData: { contents: cuerpo }, parameter: {} }
          : { parameter: Object.fromEntries(url.searchParams) };
        const fn = req.method === 'POST' ? 'doPost' : 'doGet';
        const salida = s.llamar(fn + '(' + JSON.stringify(e) + ').getContent()');
        setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(salida); }, latencia);
      });
      return;
    }
    let ruta = decodeURIComponent(url.pathname);
    if (ruta === '/') ruta = '/index.html';
    // config.js de prueba: apunta el script al simulador
    if (ruta === '/config.js') {
      const original = fs.readFileSync(path.join(carpeta, 'config.js'), 'utf8')
        .replace(/APPS_SCRIPT_URL:\s*'[^']*'/, "APPS_SCRIPT_URL:  '/exec'");
      res.writeHead(200, { 'Content-Type': tipos['.js'] }); res.end(original); return;
    }
    const archivo = path.join(carpeta, ruta);
    const respaldo = path.join(__dirname, 'recursos', path.basename(ruta));
    const real = fs.existsSync(archivo) ? archivo : (fs.existsSync(respaldo) ? respaldo : null);
    if (!real || !real.startsWith(path.resolve(carpeta)) && !real.startsWith(path.join(__dirname, 'recursos'))) {
      res.writeHead(404); res.end('no encontrado'); return;
    }
    res.writeHead(200, { 'Content-Type': tipos[path.extname(real)] || 'application/octet-stream' });
    fs.createReadStream(real).pipe(res);
  });

  return new Promise(ok => server.listen(puerto, () => ok({
    server, planilla, script: s, extra, url: 'http://localhost:' + server.address().port,
    setLatencia: ms => { latencia = ms; },
  })));
}

module.exports = { iniciar };
