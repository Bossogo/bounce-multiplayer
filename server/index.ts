import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGame } from './attach.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3001);

const server = createServer(async (req, res) => {
  if (req.url === '/health' || req.url?.startsWith('/api/ws')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const dist = path.join(root, 'dist');
  try {
    const urlPath = req.url === '/' ? '/index.html' : (req.url ?? '/');
    const filePath = path.join(dist, urlPath.split('?')[0]);
    if (!filePath.startsWith(dist)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bounce server running. Start the Vite client with pnpm dev.');
  }
});

attachGame(server);

server.listen(port, () => {
  console.log(`Bounce WS server on http://localhost:${port} (ws path /api/ws)`);
});
