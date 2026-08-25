import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

export function createGameServer() {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });
  return { httpServer, io };
}
