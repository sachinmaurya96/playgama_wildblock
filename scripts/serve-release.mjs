import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
const prefix = '/nested/wildblocks/';
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/iframe.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe title="WildBlocks" allow="autoplay; fullscreen; microphone; gyroscope" src="/nested/wildblocks/index.html" style="border:0;width:100vw;height:100dvh"></iframe></body></html>'); return;
    }
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end('Not found'); return; }
    const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
    const file = path.resolve(root, 'dist', relative);
    if (!file.startsWith(path.join(root, 'dist') + path.sep) || !(await stat(file)).isFile()) { res.writeHead(404).end('Not found'); return; }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(4178, '127.0.0.1', () => console.log('Production artifact server: http://127.0.0.1:4178/iframe.html'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
