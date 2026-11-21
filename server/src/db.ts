import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChallengeLog, Player, Sale } from '../../shared/types.js';
import { ROLE_LABEL } from '../../shared/types.js';
import type { Room } from './engine.js';

export const prisma = new PrismaClient();

const csv = (a: (string | number)[]) => a.join(',');

export const playerRow = (p: Player) => ({
  id: p.id, name: p.name, shortName: p.shortName, fullName: p.fullName, nationality: p.nationality, overseas: p.overseas,
  role: p.role, secondaryRole: p.secondaryRole, roleSource: p.roleSource ?? 'import', battingStyle: p.battingStyle,
  bowlingStyle: p.bowlingStyle, bowlingType: p.bowlingType, battingPosition: p.battingPosition, teams: csv(p.teams ?? []),
  seasons: csv(p.seasons ?? []), matches: p.matches ?? 0, active: !!p.active, lastSeason: p.lastSeason ?? 0,
  basePrice: p.basePrice ?? 30, historicalBasePrice: p.historicalBasePrice ?? null, photo: p.photo, dob: p.dob, wikipedia: p.wikipedia,
});

export async function ensureCategories() {
  for (const [code, label] of Object.entries(ROLE_LABEL)) {
    await prisma.playerCategory.upsert({ where: { code }, create: { code, label }, update: { label } });
  }
}

/** First boot: load the bundled dataset (built by scripts/build_players.py) into the local database. */
export async function seedPlayersIfEmpty() {
  await ensureCategories();
  if ((await prisma.player.count()) > 0) return;
  const file = fileURLToPath(new URL('../data/players.json', import.meta.url));
  const { players } = JSON.parse(readFileSync(file, 'utf8')) as { players: Player[] };
  for (let i = 0; i < players.length; i += 200) {
    const chunk = players.slice(i, i + 200);
    await prisma.$transaction([
      prisma.player.createMany({ data: chunk.map(playerRow) }),
      prisma.playerStatistics.createMany({ data: chunk.map((p) => ({ playerId: p.id, ...p.stats })) }),
    ]);
  }
  console.log(`[db] seeded ${players.length} players`);
}

export async function loadPlayers(): Promise<Player[]> {
  const rows = await prisma.player.findMany({ include: { stats: true }, orderBy: [{ matches: 'desc' }, { name: 'asc' }] });
  return rows.map((r) => {
    const { stats, teams, seasons, ...rest } = r;
    const { playerId: _omit, ...s } = stats ?? { playerId: '', runs: 0, balls: 0, outs: 0, highScore: 0, fours: 0, sixes: 0, wickets: 0, ballsBowled: 0, runsConceded: 0, catches: 0, stumpings: 0 };
    return { ...rest, role: r.role as Player['role'], teams: teams ? teams.split(',') : [], seasons: seasons ? seasons.split(',').map(Number) : [], stats: s };
  });
}

// ---- Room persistence -------------------------------------------------------
// The engine's in-memory state is authoritative while the server runs. Every mutation is written through
// to the database on a per-room serial queue so writes land in order and never block bidding.
const queues = new Map<string, Promise<unknown>>();
const live = new Map<string, Room>();
const written = new Set<string>();
function enqueue(code: string, job: () => Promise<unknown>) {
  const run = async () => {
    // Event rows reference the room row, so make sure it exists before the first event is written.
    if (!written.has(code) && live.has(code)) await writeRoom(live.get(code)!);
    return job();
  };
  const next = (queues.get(code) ?? Promise.resolve()).then(run).catch((e) => console.error(`[db] ${code}:`, e?.message ?? e));
  queues.set(code, next);
  return next;
}
export const flush = (code: string) => queues.get(code) ?? Promise.resolve();

const timers = new Map<string, NodeJS.Timeout>();
/** Debounced snapshot + relational mirror of room, participants, teams, settings, challenges and RTM cards. */
export function persistRoom(room: Room) {
  const code = room.state.code;
  live.set(code, room);
  if (timers.has(code)) return; // throttle: one write per 300ms window, always with the latest state
  timers.set(code, setTimeout(() => { timers.delete(code); enqueue(code, () => writeRoom(room)); }, 300));
}

async function writeRoom(room: Room) {
  const s = room.state;
  const snapshot = JSON.stringify({ state: { ...s, log: s.log.slice(-200) }, pool: room.pool, secrets: [...room.secrets], wishlists: [...room.wishlists] });
  const ops: any[] = [
    prisma.auctionRoom.upsert({
      where: { code: s.code },
      create: { code: s.code, name: s.name, hostId: s.hostId, phase: s.phase, snapshot },
      update: { name: s.name, hostId: s.hostId, phase: s.phase, snapshot },
    }),
    prisma.auctionSettings.upsert({ where: { roomCode: s.code }, create: { roomCode: s.code, json: JSON.stringify(s.settings) }, update: { json: JSON.stringify(s.settings) } }),
    prisma.participant.deleteMany({ where: { roomCode: s.code, id: { notIn: s.participants.map((p) => p.id) } } }),
    prisma.team.deleteMany({ where: { roomCode: s.code, franchise: { notIn: Object.keys(s.teams) } } }),
    prisma.challenge.deleteMany({ where: { roomCode: s.code } }),
    prisma.challenge.createMany({ data: s.challenges.map((c) => ({ roomCode: s.code, key: c.id, json: JSON.stringify(c) })) }),
  ];
  for (const p of s.participants) {
    const sec = room.secrets.get(p.id);
    if (!sec) continue;
    const data = { name: p.name, teamId: p.teamId, isHost: p.isHost, wishlist: JSON.stringify(room.wishlists.get(p.id) ?? []) };
    ops.push(prisma.user.upsert({ where: { id: sec.userId }, create: { id: sec.userId, name: p.name }, update: { name: p.name } }));
    ops.push(prisma.participant.upsert({ where: { id: p.id }, create: { id: p.id, roomCode: s.code, userId: sec.userId, token: sec.token, ...data }, update: data }));
  }
  for (const t of Object.values(s.teams)) {
    const key = { roomCode_franchise: { roomCode: s.code, franchise: t.id } };
    ops.push(prisma.team.upsert({ where: key, create: { roomCode: s.code, franchise: t.id, initialPurse: t.initialPurse, purse: t.purse }, update: { initialPurse: t.initialPurse, purse: t.purse } }));
    ops.push(prisma.rTMCard.upsert({ where: key, create: { roomCode: s.code, franchise: t.id, remaining: t.rtmLeft }, update: { remaining: t.rtmLeft } }));
  }
  await prisma.$transaction(ops);
  written.add(s.code);
}

export const store = {
  lotOpened(code: string, lotNo: number, playerId: string, basePrice: number) {
    enqueue(code, () => prisma.auction.create({ data: { roomCode: code, lotNo, playerId, basePrice, status: 'open' } }));
  },
  lotClosed(code: string, lotNo: number, status: string, finalPrice?: number, winner?: string) {
    enqueue(code, () => prisma.auction.updateMany({ where: { roomCode: code, lotNo }, data: { status, finalPrice: finalPrice ?? null, winner: winner ?? null } }));
  },
  bid(code: string, lotNo: number, playerId: string, franchise: string, amount: number) {
    enqueue(code, () => prisma.bid.create({ data: { roomCode: code, lotNo, playerId, franchise, amount } }));
  },
  /** A sale is atomic: purchase, squad row, ledger entry, purse and lot status commit together or not at all. */
  sale(code: string, sale: Sale, balanceAfter: number, note: string) {
    return enqueue(code, () => prisma.$transaction([
      prisma.purchase.create({ data: { id: sale.id, roomCode: code, playerId: sale.playerId, franchise: sale.teamId, price: sale.price, via: sale.via } }),
      prisma.squad.create({ data: { roomCode: code, franchise: sale.teamId, playerId: sale.playerId, price: sale.price, via: sale.via } }),
      prisma.auctionTransaction.create({ data: { roomCode: code, franchise: sale.teamId, type: sale.via === 'retention' ? 'retention' : 'purchase', amount: -sale.price, balanceAfter, note } }),
      prisma.team.updateMany({ where: { roomCode: code, franchise: sale.teamId }, data: { purse: balanceAfter } }),
      prisma.auction.updateMany({ where: { roomCode: code, lotNo: sale.lotNo }, data: { status: 'sold', finalPrice: sale.price, winner: sale.teamId } }),
      ...(sale.via === 'retention' ? [prisma.retention.create({ data: { roomCode: code, franchise: sale.teamId, playerId: sale.playerId, cost: sale.price } })] : []),
    ]));
  },
  /** Reverses a sale (undo) or removes a squad member (release / un-retain) together with its purse movement. */
  removal(code: string, o: { franchise: string; playerId: string; refund: number; balanceAfter: number; type: string; note: string; saleId?: string; lotNo?: number }) {
    return enqueue(code, () => prisma.$transaction([
      prisma.squad.deleteMany({ where: { roomCode: code, playerId: o.playerId } }),
      prisma.retention.deleteMany({ where: { roomCode: code, playerId: o.playerId } }),
      prisma.auctionTransaction.create({ data: { roomCode: code, franchise: o.franchise, type: o.type, amount: o.refund, balanceAfter: o.balanceAfter, note: o.note } }),
      prisma.team.updateMany({ where: { roomCode: code, franchise: o.franchise }, data: { purse: o.balanceAfter } }),
      ...(o.saleId ? [prisma.purchase.updateMany({ where: { id: o.saleId }, data: { undone: true } })] : []),
      ...(o.lotNo ? [prisma.auction.updateMany({ where: { roomCode: code, lotNo: o.lotNo }, data: { status: 'undone', finalPrice: null, winner: null } })] : []),
    ]));
  },
  ledger(code: string, franchise: string, type: string, amount: number, balanceAfter: number, note: string) {
    return enqueue(code, () => prisma.$transaction([
      prisma.auctionTransaction.create({ data: { roomCode: code, franchise, type, amount, balanceAfter, note } }),
      prisma.team.updateMany({ where: { roomCode: code, franchise }, data: { purse: balanceAfter } }),
    ]));
  },
  swap(code: string, a: { franchise: string; playerId: string }, b: { franchise: string; playerId: string }) {
    return enqueue(code, () => prisma.$transaction([
      prisma.squad.updateMany({ where: { roomCode: code, playerId: a.playerId }, data: { franchise: b.franchise, via: 'swap' } }),
      prisma.squad.updateMany({ where: { roomCode: code, playerId: b.playerId }, data: { franchise: a.franchise, via: 'swap' } }),
    ]));
  },
  challenge(code: string, h: ChallengeLog) {
    enqueue(code, () => prisma.challengeHistory.create({
      data: { id: h.id, roomCode: code, franchise: h.teamId, text: h.text, status: h.status, result: h.result, budgetDelta: h.budgetDelta, released: h.released.join(',') },
    }));
  },
  async transactions(code: string) {
    await flush(code);
    return prisma.auctionTransaction.findMany({ where: { roomCode: code }, orderBy: { id: 'asc' } });
  },
  async loadRooms() {
    const since = new Date(Date.now() - 14 * 864e5);
    const rows = await prisma.auctionRoom.findMany({ where: { updatedAt: { gte: since } }, select: { code: true, snapshot: true } });
    rows.forEach((r) => written.add(r.code));
    return rows;
  },
};
