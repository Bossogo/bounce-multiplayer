import { createServer } from 'node:http';
import { attachGame } from '../server/attach.js';

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

attachGame(server);

export default server;
