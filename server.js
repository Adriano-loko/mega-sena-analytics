import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

/**
 * Resolve a request URL path safely inside the project root.
 * @param {string} urlPath
 * @returns {string | null}
 */
function resolveSafePath(urlPath) {
  const cleanUrl = (urlPath || '/').split('?')[0];
  const relative = cleanUrl === '/' ? 'index.html' : cleanUrl.replace(/^\/+/, '');
  const fullPath = path.resolve(__dirname, relative);
  if (!fullPath.startsWith(__dirname + path.sep) && fullPath !== __dirname) {
    return null;
  }
  return fullPath;
}

const server = http.createServer(async (req, res) => {
  const targetPath = resolveSafePath(req.url);
  if (!targetPath) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso negado');
    return;
  }

  try {
    const stat = await fs.stat(targetPath);
    const filePath = stat.isDirectory() ? path.join(targetPath, 'index.html') : targetPath;
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado');
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Erro interno do servidor');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Mega-Sena Analytics rodando em http://${HOST}:${PORT}`);
});
