import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { AuctionFormat, MeState } from '../../shared/types.js';
import { loadPlayers, seedPlayersIfEmpty, store } from './db.js';
import { buildPool, defaultSettings, FORMAT_INFO } from './defaults.js';
import { Arena, Err, type Room } from './engine.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const originList = (process.env.CLIENT_ORIGINS ?? process.env.CLIENT_ORIGIN ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const corsOrigin: true | string[] = originList.length ? originList : true;
const arena = new Arena();
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '50kb' }));
const http = createServer(app);
const io = new Server(http, {
  cors: { origin: corsOrigin },
  transports: ['websocket', 'polling'],
  pingInterval: 20_000,
  pingTimeout: 60_000,
  maxHttpBufferSize: 1e6,
  allowUpgrades: true,
  perMessageDeflate: false,
});

const wrap = (fn: (req: express.Request, res: express.Response) => unknown) => async (req: express.Request, res: express.Response) => {
  try { res.json(await fn(req, res)); } catch (e) {
    if (e instanceof Err) res.status(400).json({ error: e.message });
    else { console.error(e); res.status(500).json({ error: 'Something went wrong' }); }
  }
};

// Tiny in-memory limiter so room creation / joining cannot be spammed.
const hits = new Map<string, number[]>();
const limited = (key: string, max: number, perMs: number) => {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < perMs);
  list.push(now);
  hits.set(key, list);
  if (list.length > max) throw new Err('Too many requests — slow down a little');
};

app.get('/api/health', (_req, res) => res.json({ ok: true, players: arena.playerList.length, rooms: arena.rooms.size }));

app.get('/api/players', wrap(() => ({ players: arena.playerList, latestSeason: Math.max(...arena.playerList.map((p) => p.lastSeason)) })));

app.get('/api/formats', wrap(() => (Object.keys(FORMAT_INFO) as AuctionFormat[]).map((f) => {
  const settings = defaultSettings(f);
  return { id: f, description: FORMAT_INFO[f], settings, poolSize: buildPool(arena.playerList, settings).length };
})));

app.post('/api/rooms', wrap((req) => {
  limited(`create:${req.ip}`, 10, 60_000);
  return arena.createRoom(req.body?.name, req.body?.hostName, req.body?.settings ?? {});
}));

app.get('/api/rooms/:code', wrap((req) => {
  const s = arena.room(req.params.code).state;
  return { code: s.code, name: s.name, phase: s.phase, host: s.participants.find((p) => p.id === s.hostId)?.name, teams: Object.keys(s.teams), maxTeams: s.settings.maxTeams };
}));

app.post('/api/rooms/:code/join', wrap((req) => {
  limited(`join:${req.ip}`, 30, 60_000);
  const code = arena.room(req.params.code).state.code;
  const { reclaimed, ...who } = arena.join(code, req.body?.name);
  if (reclaimed) { // the same person on a new tab/device: close the old one so only one copy of the seat is live
    const target = `${code}:${who.participantId}`;
    io.to(target).emit('replaced');
    io.in(target).disconnectSockets(true);
  }
  return { code, ...who };
}));

app.get('/api/rooms/:code/transactions', wrap(async (req) => {
  const room = arena.auth(req.params.code, String(req.query.pid), String(req.query.token));
  return store.transactions(room.state.code);
}));

// Serve the built client when it exists (single-process deployment).
const dist = fileURLToPath(new URL('../../client/dist', import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile('index.html', { root: dist }));
}

// ---- realtime ---------------------------------------------------------------
const meOf = (room: Room, pid: string): MeState => ({ participantId: pid, wishlist: room.wishlists.get(pid) ?? [] });
arena.onChange = (room, poolChanged) => {
  io.to(room.state.code).emit('state', arena.publicState(room));
  if (poolChanged) io.to(room.state.code).emit('pool', room.pool);
};
arena.onMe = (room, pid) => io.to(`${room.state.code}:${pid}`).emit('me', meOf(room, pid));

io.use((socket, next) => {
  try {
    const { code, participantId, token } = socket.handshake.auth ?? {};
    const room = arena.auth(code, participantId, token);
    socket.data = { code: room.state.code, pid: participantId };
    next();
  } catch (e) { next(new Error(e instanceof Err ? e.message : 'Unauthorized')); }
});

io.on('connection', (socket) => {
  const { code, pid } = socket.data as { code: string; pid: string };
  const room = arena.room(code);
  socket.join(code);
  socket.join(`${code}:${pid}`);
  socket.emit('pool', room.pool);
  socket.emit('me', meOf(room, pid));
  socket.emit('state', arena.publicState(room));
  arena.setConnected(room, pid, true);

  let budget = 30; // simple per-socket token bucket: 30 actions burst, refilled 10/s
  const refill = setInterval(() => { budget = Math.min(30, budget + 10); }, 1000);

  socket.on('action', (type: string, payload: unknown, ack?: (r: { ok: boolean; error?: string }) => void) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      if (budget-- <= 0) throw new Err('Too many actions — slow down');
      arena.auth(code, pid, (socket.handshake.auth as any).token); // rejects removed participants
      arena.act(room, pid, String(type), payload ?? {});
      if (type === 'kick') {
        const target = `${code}:${(payload as any)?.participantId}`;
        io.to(target).emit('kicked');
        io.in(target).disconnectSockets(true);
      }
      reply({ ok: true });
    } catch (e) {
      if (!(e instanceof Err)) console.error('[action]', type, e);
      reply({ ok: false, error: e instanceof Err ? e.message : 'Something went wrong' });
    }
  });

  socket.on('disconnect', async () => {
    clearInterval(refill);
    const still = await io.in(`${code}:${pid}`).fetchSockets();
    if (!still.length) arena.setConnected(room, pid, false);
  });
});

async function main() {
  await seedPlayersIfEmpty();
  arena.setPlayers(await loadPlayers());
  for (const r of await store.loadRooms()) {
    try { arena.restore(r.snapshot); } catch (e) { console.error('[restore]', e); }
  }
  http.keepAliveTimeout = 65_000;
  http.headersTimeout = 66_000;
  http.listen(PORT, HOST, () => console.log(`[arena] ${arena.playerList.length} players, ${arena.rooms.size} rooms restored — http://localhost:${PORT}`));
  const shutdown = () => {
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 25_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
main();
