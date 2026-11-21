// End-to-end multiplayer test: boots a real server and drives it with several socket clients.
//   npm test   (from server/)
import { spawn } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import type { RoomState } from '../../shared/types.js';

const PORT = 4123, URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { env: { ...process.env, PORT: String(PORT), HOST_TRANSFER_MS: '800' }, stdio: ['ignore', 'pipe', 'inherit'] });
let pass = 0, failN = 0;
const ok = (cond: unknown, name: string) => { if (cond) { pass++; console.log('  ✓', name); } else { failN++; console.log('  ✗ FAIL:', name); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (path: string, body: unknown) => fetch(URL + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as any);

class Client {
  socket!: Socket; state!: RoomState; pool: string[] = [];
  constructor(public code: string, public pid: string, public token: string) {}
  connect() {
    this.socket = io(URL, { auth: { code: this.code, participantId: this.pid, token: this.token }, transports: ['websocket'] });
    this.socket.on('state', (s) => (this.state = s));
    this.socket.on('pool', (p) => (this.pool = p));
    return new Promise<void>((res, rej) => { this.socket.once('state', () => res()); this.socket.once('connect_error', rej); });
  }
  act(type: string, payload: unknown = {}) {
    return new Promise<{ ok: boolean; error?: string }>((res) => this.socket.emit('action', type, payload, res));
  }
}

async function run() {
  await new Promise<void>((res) => server.stdout!.on('data', (d) => String(d).includes('http://localhost') && res()));
  const players = (await fetch(URL + '/api/players').then((r) => r.json() as any)).players;
  ok(players.length > 700, `player database loaded (${players.length} players)`);

  console.log('\nRoom, joining and franchises');
  const created = await post('/api/rooms', { name: 'Test', hostName: 'Host', settings: { timerSec: 0, autoNext: false, minSquad: 2, challengeEvery: 0 } });
  const host = new Client(created.code, created.participantId, created.token);
  const mk = async (name: string) => { const j = await post(`/api/rooms/${created.code}/join`, { name }); return new Client(created.code, j.participantId, j.token); };
  const b = await mk('Bea'), c = await mk('Cal'), d = await mk('Dee');
  await Promise.all([host, b, c, d].map((x) => x.connect()));
  ok(host.state.participants.length === 4, 'four users in the same room');
  ok((await host.act('team.select', { teamId: 'CSK' })).ok, 'host takes CSK');
  const dup = await b.act('team.select', { teamId: 'CSK' });
  ok(!dup.ok && /taken/.test(dup.error!), 'duplicate franchise is rejected');
  await b.act('team.select', { teamId: 'MI' }); await c.act('team.select', { teamId: 'RCB' });
  ok(!(await b.act('start')).ok, 'non-host cannot start the auction');
  ok(!(await b.act('settings.update', { settings: { purse: 99999 } })).ok, 'non-host cannot change settings');
  ok((await host.act('start')).ok, 'host starts the auction');
  await sleep(50);
  ok(Object.values(host.state.teams).every((t) => t.purse === 12000), 'every team starts with ₹120 Cr');
  const bad = io(URL, { auth: { code: created.code, participantId: b.pid, token: 'forged' }, transports: ['websocket'] });
  ok(await new Promise((res) => { bad.once('connect_error', () => res(true)); bad.once('connect', () => res(false)); }), 'forged session token is refused');
  bad.close();

  console.log('\nBidding and purse');
  const P1 = host.pool[0], P2 = host.pool[1], P3 = host.pool[2];
  ok(!(await b.act('next')).ok, 'non-host cannot introduce a player');
  ok((await host.act('next', { playerId: P1 })).ok, 'host introduces a player');
  await sleep(50);
  const base = host.state.lot!.basePrice;
  ok(!(await b.act('bid', { amount: base - 10 })).ok, 'bid below base price is rejected');
  ok((await b.act('bid', { amount: base })).ok, 'MI bids the base price');
  ok(!(await b.act('bid', { amount: base + 100 })).ok, 'cannot outbid yourself');
  ok(!(await c.act('bid', { amount: base })).ok, 'equal bid is rejected');
  ok(!(await c.act('bid', { amount: 999999 })).ok, 'bid beyond the purse is rejected');
  ok(!(await c.act('bid', { amount: 12000 })).ok, 'bid that would starve mandatory squad slots is rejected');
  ok(!(await d.act('bid', { amount: base + 100 })).ok, 'spectator without a franchise cannot bid');
  const both = await Promise.all([host.act('bid', { amount: base + 50 }), c.act('bid', { amount: base + 50 })]);
  ok(both.filter((r) => r.ok).length === 1, 'simultaneous identical bids: exactly one wins');
  await c.act('bid', { amount: 1200 }); await b.act('bid', { amount: 1250 });
  await sleep(80);
  ok([host, b, c, d].every((x) => x.state.lot!.bid === 1250 && x.state.lot!.bidder === 'MI'), 'all participants see the same highest bid');
  ok(!(await b.act('sold')).ok, 'non-host cannot hammer the sale');
  ok((await host.act('sold')).ok, 'host sells the player');
  await sleep(80);
  let s = host.state;
  ok(s.teams.MI.purse === 12000 - 1250, 'winning purse deducted exactly (₹120 Cr − ₹12.5 Cr)');
  ok(s.teams.CSK.purse === 12000 && s.teams.RCB.purse === 12000, 'other purses untouched');
  ok(s.status[P1] === 'sold' && s.teams.MI.squad[0].playerId === P1, 'player marked SOLD and added to the squad');
  ok(!(await host.act('next', { playerId: P1 })).ok, 'a sold player cannot be auctioned again');

  console.log('\nUnsold, undo, timer');
  await host.act('next', { playerId: P2 }); await host.act('unsold'); await sleep(50);
  ok(host.state.status[P2] === 'unsold' && Object.values(host.state.teams).reduce((a, t) => a + t.purse, 0) === 36000 - 1250, 'unsold player costs nobody anything');
  ok((await host.act('undo')).ok, 'host undoes the last sale'); await sleep(50);
  s = host.state;
  ok(s.teams.MI.purse === 12000 && s.teams.MI.squad.length === 0 && !s.status[P1] && s.sales.length === 0, 'undo fully restores purse, squad and player status');
  await host.act('settings.update', { settings: { timerSec: 1, antiSnipeSec: 1 } });
  await host.act('next', { playerId: P1 }); await c.act('bid', { amount: 300 }); await sleep(1600);
  ok(host.state.status[P1] === 'sold' && host.state.teams.RCB.purse === 11700, 'countdown timer sells to the highest bidder automatically');
  await host.act('settings.update', { settings: { timerSec: 0 } });
  await host.act('next', { playerId: P3 }); await host.act('pause');
  ok(!(await b.act('bid', { amount: 500 })).ok, 'bids are refused while paused');
  await host.act('resume'); ok((await b.act('bid', { amount: 500 })).ok, 'bidding continues after resume');
  await host.act('sold'); await sleep(50);

  console.log('\nChallenges');
  ok(!(await b.act('ch.assign', { teamId: 'CSK', challengeId: 'b3' })).ok, 'non-host cannot assign challenges');
  await host.act('ch.assign', { teamId: 'CSK', challengeId: 'b3' }); await sleep(50);
  ok(host.state.teams.CSK.purse === 11500, 'budget challenge really removes ₹5 Cr');
  await host.act('ch.assign', { teamId: 'MI', challengeId: 'p1' }); await sleep(50);
  s = host.state;
  ok(s.teams.MI.squad.length === 0 && s.status[P3] === 'unsold' && s.teams.MI.purse === 12000 - 500 + 250, 'release challenge removes the player and refunds 50%');
  ok(s.challengeLog.length === 2 && s.challengeLog[1].released[0] === P3, 'challenge history records the result');
  await host.act('ch.assign', { teamId: 'RCB', challengeId: 'p4' });
  await host.act('next', { playerId: host.pool[5] });
  ok(!(await c.act('bid', { amount: 400 })).ok, 'skip challenge blocks the team from bidding');
  await host.act('unsold'); await host.act('next', { playerId: host.pool[6] });
  ok((await c.act('bid', { amount: 400 })).ok, 'restriction clears after one round');
  await host.act('unsold');
  const sp1 = await host.act('ch.spinTeam'), sp2 = await host.act('ch.spinChallenge'); await sleep(50);
  if (!sp1.ok || !sp2.ok) console.log('   spin errors:', sp1.error, sp2.error);
  ok(host.state.teamWheel && host.state.challengeWheel && (host.state.challengeLog.length === 4 || host.state.run), 'two separate wheels pick a team and then a challenge');
  if (host.state.run) await host.act('ch.cancel');

  console.log('\nSpin modes');
  const up = () => host.pool.find((id) => !host.state.status[id])!;
  const anyBid = async () => { for (const x of [host, b, c]) { const lot = host.state.lot!; if ((await x.act('bid', { amount: lot.bidder ? lot.bid + 100 : lot.basePrice })).ok) return true; } return false; };
  ok(!(await b.act('ch.spinTeam')).ok, 'auto mode: a regular team cannot spin');
  await host.act('next', { playerId: up() }); await sleep(50);
  ok((await host.act('ch.spinTeam')).ok, 'host can press Spin while a player is on the block');
  await sleep(50);
  ok(host.state.challengeDue && !host.state.run && !!host.state.lot, '…which queues the challenge instead of interrupting the bidding');
  ok(!(await host.act('ch.spinTeam')).ok, 'a spin cannot be queued twice');
  await host.act('unsold'); await sleep(3400);
  ok(!!host.state.teamWheel && !!host.state.run?.teamId && !host.state.challengeWheel, 'queued spin: team wheel spins automatically once the player closes');
  ok(!(await host.act('next')).ok, 'next player is refused while a challenge is in progress');
  await sleep(6300);
  ok(!!host.state.challengeWheel && !host.state.challengeDue, 'challenge wheel follows automatically');
  if (host.state.run) await host.act('ch.cancel');

  await host.act('settings.update', { settings: { challengeEvery: 1 } });
  await host.act('next', { playerId: up() }); await anyBid(); await host.act('sold'); await sleep(50);
  ok(host.state.challengeDue, 'auto mode: a challenge becomes due after N sales');
  await sleep(3400);
  ok(!!host.state.run || host.state.challengeLog.length > 0 && !host.state.challengeDue, 'auto mode: wheels spin on their own when a challenge is due');
  await sleep(6300);
  if (host.state.run) await host.act('ch.cancel');

  await host.act('settings.update', { settings: { spinBy: 'rotation', challengeEvery: 1 } }); await sleep(50);
  const byTeam: Record<string, Client> = { CSK: host, MI: b, RCB: c };
  const turnOf = () => Object.keys(host.state.teams)[host.state.spinTurn % Object.keys(host.state.teams).length];
  if (turnOf() === 'CSK') { await host.act('ch.assign', { teamId: 'CSK', challengeId: 'b6' }); await sleep(50); }
  const holder = byTeam[turnOf()], other = [b, c].find((x) => x !== holder)!;
  ok(!(await holder.act('ch.spinTeam')).ok, 'rotation: the turn holder cannot spin before a challenge is due');
  await host.act('next', { playerId: up() }); await anyBid(); await host.act('sold'); await sleep(3400);
  ok(host.state.challengeDue && !host.state.run, 'rotation: nothing spins automatically');
  ok(!(await other.act('ch.spinTeam')).ok, 'rotation: a team that is not on turn cannot spin');
  const turnBefore = host.state.spinTurn;
  ok((await holder.act('ch.spinTeam')).ok && (await holder.act('ch.spinChallenge')).ok, 'rotation: the team on turn spins both wheels');
  await sleep(50);
  ok(host.state.spinTurn === turnBefore + 1, 'rotation: the turn passes to the next team');
  if (host.state.run) await host.act('ch.cancel');
  await host.act('settings.update', { settings: { spinBy: 'auto', challengeEvery: 0 } });

  console.log('\nReconnect, host handover, ledger');
  b.socket.close(); await sleep(150);
  ok(host.state.participants.find((p) => p.id === b.pid)!.connected === false, 'disconnect is visible to others');
  await b.connect(); await sleep(100);
  ok(b.state.participants.find((p) => p.id === b.pid)!.teamId === 'MI' && b.state.teams.MI.purse === host.state.teams.MI.purse, 'reconnecting restores the same seat and state');
  const tx = await fetch(`${URL}/api/rooms/${created.code}/transactions?pid=${host.pid}&token=${host.token}`).then((r) => r.json() as any);
  const net = (f: string) => tx.filter((t: any) => t.franchise === f).reduce((a: number, t: any) => a + t.amount, 0);
  ok(['CSK', 'MI', 'RCB'].every((f) => 12000 + net(f) === host.state.teams[f].purse), 'database ledger reconciles with every purse');
  ok((await host.act('kick', { participantId: d.pid })).ok, 'host can remove a participant');
  await sleep(100);
  ok(!host.state.participants.some((p) => p.id === d.pid) && d.socket.disconnected, 'removed participant is disconnected');
  host.socket.close(); await sleep(1300);
  ok(b.state.hostId !== host.pid && b.state.participants.find((p) => p.id === b.state.hostId)!.connected, 'host seat transfers when the host stays disconnected');

  console.log(`\n${pass} passed, ${failN} failed`);
}
run().catch((e) => { console.error(e); failN++; }).finally(() => { server.kill(); process.exit(failN ? 1 : 0); });
