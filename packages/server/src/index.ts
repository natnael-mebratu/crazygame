import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@crazy/engine';
import { RoomManager } from './rooms';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = path.resolve(here, '../../web/dist');

const app = express();
app.get('/health', (_req, res) => {
  res.send('ok');
});
if (existsSync(webDist)) {
  app.use(express.static(webDist, { maxAge: '1h', index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: true },
  pingInterval: 10_000,
  pingTimeout: 8_000,
});
new RoomManager(io).listen();

const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => {
  console.log(`Crazy server listening on http://localhost:${port}`);
});
