/**
 * Sirve el renderer compilado y reenvía /api al nodo, como hace la terminal.
 * Existe para que [capturar-manual.mjs](./capturar-manual.mjs) abra la interfaz
 * real sin levantar el entorno de desarrollo completo.
 */
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'out', 'renderer');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png'
};

http.createServer((request, response) => {
  if (request.url.startsWith('/api')) {
    const proxy = http.request(
      { host: '127.0.0.1', port: 3000, path: request.url, method: request.method,
        headers: { ...request.headers, host: '127.0.0.1:3000' } },
      (upstream) => {
        response.writeHead(upstream.statusCode, upstream.headers);
        upstream.pipe(response);
      }
    );
    proxy.on('error', () => { response.writeHead(502); response.end('sin nodo'); });
    request.pipe(proxy);
    return;
  }
  const path = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const file = join(ROOT, path);
  if (!existsSync(file)) { response.writeHead(404); response.end('no'); return; }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
}).listen(5199, '127.0.0.1', () => process.stdout.write('renderer en 5199\n'));
