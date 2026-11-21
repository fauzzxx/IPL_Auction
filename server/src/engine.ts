// Server-authoritative auction engine. Clients only ever send intents ("bid 250", "spin the wheel");
// every rule — purse, squad limits, turn restrictions, host permissions — is checked here.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  FRANCHISES, MIN_BASE, fmt, franchise, maxBid, minNextBid,
  type ChallengeDef, type ChallengeLog, type EffectType, type Lot, type Participant, type Player, type Restrictions,
  type RoomState, type Sale, type Settings, type TeamState, spinTurnTeam,
} from '../../shared/types.js';
import { buildPool, defaultChallenges, defaultSettings, sanitizeSettings } from './defaults.js';
import { persistRoom, store } from './db.js';

export class Err extends Error {}
const fail = (m: string): never => { throw new Err(m); };

export interface Room {
  state: RoomState;
  pool: string[];
  secrets: Map<string, { token: string; userId: string }>;
  wishlists: Map<string, string[]>;
  timer?: NodeJS.Timeout;
  nextTimer?: NodeJS.Timeout;
  hostTimer?: NodeJS.Timeout;
  spinQueued?: boolean; // host/turn-holder pressed spin while a player was on the block
  logSeq: number;
}

const noRestrictions = (): Restrictions => ({ skipRounds: 0, mustBid: 0, nextBuy: null, nextBuyMax: null, minRaise: 0, releaseFirst: false, nominations: 0 });
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAM_FX: EffectType[] = ['target_budget', 'target_skip'];
const HOST_TRANSFER_MS = Number(process.env.HOST_TRANSFER_MS ?? 45_000);
const AUTO_NEXT_MS = 5_000;
const AUTO_SPIN_DELAY_MS = 3_000; // let everyone see the SOLD stamp first
const WHEEL_MS = 6_000; // client wheel animation (4.6s) plus a moment to read the team

export class Arena {
  rooms = new Map<string, Room>();
  players = new Map<string, Player>();
  playerList: Player[] = [];
  onChange: (room: Room, poolChanged: boolean) => void = () => {};
  onMe: (room: Room, participantId: string) => void = () => {};

  setPlayers(list: Player[]) {
    this.playerList = list;
    this.players = new Map(list.map((p) => [p.id, p]));
  }

  // ---------------------------------------------------------------- helpers
  private commit(room: Room, poolChanged = false) {
    room.state.poolSize = room.pool.length;
    if (poolChanged) room.state.poolVersion++;
    persistRoom(room);
    this.onChange(room, poolChanged);
  }

  private log(room: Room, kind: string, text: string, extra: { teamId?: string; playerId?: string; by?: string } = {}) {
    room.state.log.push({ id: ++room.logSeq, t: Date.now(), kind, text, ...extra });
    if (room.state.log.length > 400) room.state.log.splice(0, room.state.log.length - 400);
  }

  private me(room: Room, pid: string): Participant {
    return room.state.participants.find((p) => p.id === pid) ?? fail('You are not in this room');
  }
  private host(room: Room, pid: string) {
    if (room.state.hostId !== pid) fail('Only the host can do that');
  }
  private myTeam(room: Room, pid: string): TeamState {
    const p = this.me(room, pid);
    return (p.teamId && room.state.teams[p.teamId]) || fail('Pick a franchise first');
  }
  private player(id: string): Player {
    return this.players.get(id) ?? fail('Unknown player');
  }
  private base(room: Room, id: string) {
    return room.state.baseOverrides[id] ?? this.player(id).basePrice;
  }
  private overseas(t: TeamState) {
    return t.squad.filter((s) => this.players.get(s.playerId)?.overseas).length;
  }
  private upcoming(room: Room) {
    return room.pool.filter((id) => !room.state.status[id]);
  }
  private tname(id: string) {
    return franchise(id)?.name ?? id;
  }
  private adjust(room: Room, t: TeamState, delta: number, type: string, note: string) {
    const applied = Math.max(-t.purse, delta); // a purse can never go below zero
    t.purse += applied;
    store.ledger(room.state.code, t.id, type, applied, t.purse, note);
    return applied;
  }

  // ---------------------------------------------------------------- rooms & identity
  createRoom(name: string, hostName: string, patch: Partial<Settings> = {}) {
    let code = '';
    do code = Array.from(randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join(''); while (this.rooms.has(code));
    const settings = sanitizeSettings(defaultSettings(patch.format ?? 'mega'), patch);
    const state: RoomState = {
      code, name: clean(name, 40) || 'IPL Mega Auction', hostId: '', phase: 'lobby', paused: false, settings,
      participants: [], teams: {}, status: {}, baseOverrides: {}, poolSize: 0, poolVersion: 0, lot: null, lotCount: 0,
      lastResult: null, sales: [], challenges: defaultChallenges(), run: null, challengeLog: [], usedChallenges: [],
      challengeDue: false, salesSinceChallenge: 0, spinTurn: 0, teamWheel: null, challengeWheel: null, log: [], serverNow: Date.now(),
    };
    const room: Room = { state, pool: buildPool(this.playerList, settings), secrets: new Map(), wishlists: new Map(), logSeq: 0 };
    this.rooms.set(code, room);
    const who = this.join(code, hostName);
    state.hostId = who.participantId;
    state.creatorId = who.participantId;
    state.participants[0].isHost = true;
    this.log(room, 'room', `${state.participants[0].name} created the room`);
    this.commit(room, true);
    return { code, ...who };
  }

  room(code: string): Room {
    return this.rooms.get(String(code || '').toUpperCase()) ?? fail('Room not found');
  }

  join(code: string, name: string) {
    const room = this.room(code);
    const nm = clean(name, 20) || fail('Enter a display name');
    // Rejoining with the same name gives back your old seat (franchise, purse, squad) if that seat is offline.
    // A phone in the background can keep a dead connection looking "online" for ~45s, so the seat is reclaimed
    // either way; the old connection is closed by the caller (see `reclaimed`).
    const s = room.state;
    const old = s.participants.find((p) => p.name.toLowerCase() === nm.toLowerCase());
    if (old && s.hostId) {
      const token = randomBytes(24).toString('hex');
      room.secrets.set(old.id, { token, userId: room.secrets.get(old.id)?.userId ?? randomUUID() });
      if (s.creatorId === old.id && s.hostId !== old.id) { // the room's creator always gets host controls back
        s.participants.forEach((p) => (p.isHost = p.id === old.id));
        s.hostId = old.id;
        clearTimeout(room.hostTimer);
        this.log(room, 'room', `${old.name} is back and is the host again`);
      } else this.log(room, 'room', `${old.name} rejoined`);
      this.commit(room);
      return { participantId: old.id, token, reclaimed: true };
    }
    if (room.state.participants.length >= 40) fail('Room is full');
    const p: Participant = { id: randomUUID(), name: nm, teamId: null, connected: false, isHost: false };
    room.state.participants.push(p);
    const token = randomBytes(24).toString('hex');
    room.secrets.set(p.id, { token, userId: randomUUID() });
    room.wishlists.set(p.id, []);
    if (room.state.hostId) { this.log(room, 'room', `${nm} joined`); this.commit(room); }
    return { participantId: p.id, token, reclaimed: false };
  }

  auth(code: string, pid: string, token: string): Room {
    const room = this.room(code);
    if (room.secrets.get(pid)?.token !== token || !room.state.participants.some((p) => p.id === pid)) fail('Session expired — rejoin the room');
    return room;
  }

  setConnected(room: Room, pid: string, connected: boolean) {
    const p = room.state.participants.find((x) => x.id === pid);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    if (pid === room.state.hostId) {
      clearTimeout(room.hostTimer);
      // Host dropped: the auction keeps running on its timers; if they stay away the host seat moves on.
      if (!connected) room.hostTimer = setTimeout(() => this.transferHost(room), HOST_TRANSFER_MS);
    }
    this.commit(room);
  }

  private transferHost(room: Room) {
    const s = room.state;
    const cur = s.participants.find((p) => p.id === s.hostId);
    if (cur?.connected) return;
    const next = s.participants.find((p) => p.connected && p.teamId) ?? s.participants.find((p) => p.connected);
    if (!next) return;
    if (cur) cur.isHost = false;
    next.isHost = true;
    s.hostId = next.id;
    this.log(room, 'room', `Host disconnected — ${next.name} is now the host`);
    this.commit(room);
  }

  publicState(room: Room): RoomState {
    return { ...room.state, serverNow: Date.now() };
  }

  // ---------------------------------------------------------------- action dispatcher
  act(room: Room, pid: string, type: string, a: any = {}) {
    const s = room.state;
    this.me(room, pid);
    switch (type) {
      case 'chat': {
        const text = clean(a.text, 200);
        if (text) { this.log(room, 'chat', text, { by: this.me(room, pid).name, teamId: this.me(room, pid).teamId ?? undefined }); this.commit(room); }
        return;
      }
      case 'wishlist.toggle': {
        this.player(a.playerId);
        const w = room.wishlists.get(pid) ?? [];
        const i = w.indexOf(a.playerId);
        if (i >= 0) w.splice(i, 1); else if (w.length < 300) w.push(a.playerId);
        room.wishlists.set(pid, w);
        persistRoom(room);
        this.onMe(room, pid);
        return;
      }
      case 'team.select': return this.selectTeam(room, pid, a.teamId);
      case 'team.leave': return this.leaveTeam(room, pid);
      case 'team.randomize': return this.randomizeTeams(room, pid);
      case 'settings.update': return this.updateSettings(room, pid, a.settings ?? {}, a.name);
      case 'kick': return this.kick(room, pid, a.participantId);
      case 'player.setBase': return this.setBase(room, pid, a.playerId, a.price);
      case 'player.withdraw': return this.withdraw(room, pid, a.playerId, a.restore);
      case 'start': return this.start(room, pid);
      case 'retain': return this.retain(room, pid, a.playerId);
      case 'unretain': return this.unretain(room, pid, a.playerId);
      case 'beginBidding': return this.beginBidding(room, pid);
      case 'next': this.host(room, pid); return this.openNext(room, a.playerId, a.random);
      case 'nominate': return this.nominate(room, pid, a.playerId);
      case 'bid': return this.bid(room, pid, a.amount);
      case 'sold': this.host(room, pid); return this.hammer(room, true);
      case 'unsold': this.host(room, pid); return this.hammer(room, false);
      case 'skip': return this.skip(room, pid);
      case 'pause': this.host(room, pid); return this.pause(room, false);
      case 'emergency': this.host(room, pid); return this.pause(room, true);
      case 'resume': return this.resume(room, pid);
      case 'undo': return this.undo(room, pid);
      case 'reauction': return this.reauction(room, pid);
      case 'rtm.use': return this.useRtm(room, pid);
      case 'rtm.decline': this.host(room, pid); if (s.lot?.rtm) this.completeSale(room, s.lot.bidder!, 'auction'); return;
      case 'release': return this.voluntaryRelease(room, pid, a.playerId);
      case 'end': return this.end(room, pid);
      case 'ch.save': return this.saveChallenge(room, pid, a.challenge);
      case 'ch.delete': this.host(room, pid); s.challenges = s.challenges.filter((c) => c.id !== a.id); return this.commit(room);
      case 'ch.spinTeam': return this.spinTeam(room, pid);
      case 'ch.spinChallenge': return this.spinChallenge(room, pid);
      case 'ch.assign': return this.assignChallenge(room, pid, a.teamId, a.challengeId);
      case 'ch.surprise': return this.surprise(room, pid);
      case 'ch.respond': return this.respondChallenge(room, pid, !!a.accept);
      case 'ch.input': return this.challengeInput(room, pid, a);
      case 'ch.swapRespond': return this.swapRespond(room, pid, !!a.accept);
      case 'ch.cancel': this.host(room, pid); if (s.run) { this.finishRun(room, 'cancelled', 'Cancelled by the host'); } return;
      default: fail('Unknown action');
    }
  }

  // ---------------------------------------------------------------- lobby
  private selectTeam(room: Room, pid: string, teamId: string) {
    const s = room.state;
    const p = this.me(room, pid);
    if (s.phase === 'ended') fail('The auction has ended');
    if (!franchise(teamId)) fail('Unknown franchise');
    const existing = s.teams[teamId];
    if (existing?.ownerId && existing.ownerId !== pid) fail(`${this.tname(teamId)} is already taken`);
    if (p.teamId === teamId) return;
    if (p.teamId && s.phase !== 'lobby') fail('You cannot switch franchise once the auction has started');
    if (!existing && Object.keys(s.teams).length - (p.teamId ? 1 : 0) >= s.settings.maxTeams) fail(`This room is limited to ${s.settings.maxTeams} teams`);
    if (p.teamId) delete s.teams[p.teamId];
    if (existing) existing.ownerId = pid; // re-claim a franchise whose owner left mid-auction
    else s.teams[teamId] = { id: teamId, ownerId: pid, initialPurse: s.settings.purse, purse: s.settings.purse, squad: [], rtmLeft: s.settings.rtmEnabled ? s.settings.rtmCards : 0, r: noRestrictions() };
    p.teamId = teamId;
    this.log(room, 'team', `${p.name} will run ${this.tname(teamId)}`, { teamId });
    this.commit(room);
  }

  private leaveTeam(room: Room, pid: string) {
    const p = this.me(room, pid);
    if (room.state.phase !== 'lobby') fail('You cannot leave your franchise once the auction has started');
    if (p.teamId) { delete room.state.teams[p.teamId]; p.teamId = null; this.commit(room); }
  }

  private randomizeTeams(room: Room, pid: string) {
    this.host(room, pid);
    const s = room.state;
    if (s.phase !== 'lobby') fail('Franchises can only be shuffled in the lobby');
    const ids = FRANCHISES.map((f) => f.id).sort(() => Math.random() - 0.5);
    s.teams = {};
    s.participants.forEach((p) => (p.teamId = null));
    s.participants.slice(0, s.settings.maxTeams).forEach((p, i) => {
      p.teamId = ids[i];
      s.teams[ids[i]] = { id: ids[i], ownerId: p.id, initialPurse: s.settings.purse, purse: s.settings.purse, squad: [], rtmLeft: 0, r: noRestrictions() };
    });
    this.log(room, 'team', 'The host shuffled the franchises at random');
    this.commit(room);
  }

  private updateSettings(room: Room, pid: string, patch: Partial<Settings>, name?: string) {
    this.host(room, pid);
    const s = room.state;
    const before = s.settings;
    let next = sanitizeSettings(before, patch);
    if (s.phase !== 'lobby') {
      // Structural rules are frozen once the auction is under way; pacing and challenge options stay editable.
      next = { ...next, format: before.format, purse: before.purse, maxTeams: before.maxTeams, retentionEnabled: before.retentionEnabled, maxRetentions: before.maxRetentions, retentionCosts: before.retentionCosts, poolMinMatches: before.poolMinMatches, poolStatus: before.poolStatus, rtmCards: before.rtmCards };
    } else {
      if (patch.format && patch.format !== before.format) next = sanitizeSettings(defaultSettings(patch.format), { purse: next.purse, maxTeams: next.maxTeams });
      if (Object.keys(s.teams).length > next.maxTeams) fail('More franchises are already taken than that team limit allows');
      if (name !== undefined) s.name = clean(name, 40) || s.name;
    }
    s.settings = next;
    let poolChanged = false;
    if (s.phase === 'lobby') {
      for (const t of Object.values(s.teams)) { t.initialPurse = t.purse = next.purse; }
      const keys: (keyof Settings)[] = ['format', 'nominationOrder', 'poolMinMatches', 'poolStatus'];
      if (keys.some((k) => before[k] !== next[k])) { room.pool = buildPool(this.playerList, next); poolChanged = true; }
    }
    this.commit(room, poolChanged);
  }

  private kick(room: Room, pid: string, target: string) {
    this.host(room, pid);
    const s = room.state;
    if (target === pid) fail('You cannot remove yourself');
    const p = s.participants.find((x) => x.id === target) ?? fail('Participant not found');
    if (p.teamId && s.teams[p.teamId]) {
      if (s.phase === 'lobby') delete s.teams[p.teamId];
      else s.teams[p.teamId].ownerId = null; // squad and purse stay on the books
    }
    s.participants = s.participants.filter((x) => x.id !== target);
    room.secrets.delete(target);
    room.wishlists.delete(target);
    this.log(room, 'room', `${p.name} was removed by the host`);
    this.commit(room);
  }

  private setBase(room: Room, pid: string, playerId: string, price: number) {
    this.host(room, pid);
    this.player(playerId);
    const v = Math.round(Number(price));
    if (!Number.isFinite(v) || v < 5 || v > 5000) fail('Base price must be between ₹5 L and ₹50 Cr');
    if (room.state.status[playerId] && room.state.status[playerId] !== 'unsold') fail('This player has already been auctioned');
    room.state.baseOverrides[playerId] = v;
    this.commit(room);
  }

  private withdraw(room: Room, pid: string, playerId: string, restore?: boolean) {
    this.host(room, pid);
    const st = room.state.status;
    if (restore) { if (st[playerId] === 'withdrawn') delete st[playerId]; }
    else {
      if (!room.pool.includes(playerId)) fail('Player is not in this auction pool');
      if (st[playerId] && st[playerId] !== 'unsold') fail('Only upcoming or unsold players can be withdrawn');
      st[playerId] = 'withdrawn';
    }
    this.commit(room);
  }

  private start(room: Room, pid: string) {
    this.host(room, pid);
    const s = room.state;
    if (s.phase !== 'lobby') fail('The auction has already started');
    const teams = Object.values(s.teams);
    if (teams.length < 2) fail('At least two franchises must be taken before starting');
    for (const t of teams) {
      t.initialPurse = t.purse = s.settings.purse; // identical purse for everyone — no head starts
      t.rtmLeft = s.settings.rtmEnabled ? s.settings.rtmCards : 0;
      t.squad = []; t.r = noRestrictions();
    }
    if (s.settings.retentionEnabled && s.settings.maxRetentions > 0) {
      s.phase = 'retention';
      this.log(room, 'phase', 'Retention window is open');
    } else {
      s.phase = 'auction';
      this.log(room, 'phase', `Auction started — every team has ${fmt(s.settings.purse)}`);
      this.scheduleNext(room);
    }
    this.commit(room);
  }

  // ---------------------------------------------------------------- retention
  private retain(room: Room, pid: string, playerId: string) {
    const s = room.state;
    if (s.phase !== 'retention') fail('Retention window is closed');
    const t = this.myTeam(room, pid);
    const p = this.player(playerId);
    const kept = t.squad.filter((e) => e.via === 'retention').length;
    if (kept >= s.settings.maxRetentions) fail(`You can retain at most ${s.settings.maxRetentions} players`);
    if (!room.pool.includes(playerId) || s.status[playerId]) fail('That player is not available');
    if (!p.teams.includes(t.id)) fail(`${p.name} has never played for ${this.tname(t.id)}`);
    if (p.overseas && this.overseas(t) >= s.settings.maxOverseas) fail('Overseas limit reached');
    const cost = s.settings.retentionCosts[Math.min(kept, s.settings.retentionCosts.length - 1)];
    if (cost > t.purse) fail('Not enough purse to retain this player');
    t.purse -= cost;
    t.squad.push({ playerId, price: cost, via: 'retention', protected: false });
    s.status[playerId] = 'sold';
    const sale: Sale = { id: randomUUID(), lotNo: 0, playerId, teamId: t.id, price: cost, via: 'retention', t: Date.now(), bids: [] };
    store.sale(s.code, sale, t.purse, `Retained ${p.name}`);
    this.log(room, 'retain', `${this.tname(t.id)} retained ${p.name} for ${fmt(cost)}`, { teamId: t.id, playerId });
    this.commit(room);
  }

  private unretain(room: Room, pid: string, playerId: string) {
    const s = room.state;
    if (s.phase !== 'retention') fail('Retention window is closed');
    const t = this.myTeam(room, pid);
    const e = t.squad.find((x) => x.playerId === playerId && x.via === 'retention') ?? fail('Not one of your retentions');
    t.squad = t.squad.filter((x) => x !== e);
    t.purse += e.price;
    delete s.status[playerId];
    store.removal(s.code, { franchise: t.id, playerId, refund: e.price, balanceAfter: t.purse, type: 'undo', note: `Retention of ${this.player(playerId).name} cancelled` });
    this.commit(room);
  }

  private beginBidding(room: Room, pid: string) {
    this.host(room, pid);
    if (room.state.phase !== 'retention') fail('Not in the retention window');
    room.state.phase = 'auction';
    this.log(room, 'phase', 'Retentions locked. The auction is live!');
    this.scheduleNext(room);
    this.commit(room);
  }

  // ---------------------------------------------------------------- lots & bidding
  private openNext(room: Room, playerId?: string, random?: boolean) {
    const s = room.state;
    if (s.phase !== 'auction') fail('The auction is not running');
    if (s.paused) fail('Resume the auction first');
    if (s.lot) fail('Close the current player first');
    if (s.run) fail('Finish or cancel the current challenge first');
    let id = playerId;
    if (!id) {
      const up = this.upcoming(room);
      if (!up.length) fail(Object.values(s.status).includes('unsold') ? 'No upcoming players left — re-auction the unsold players or end the auction' : 'Every player has been auctioned');
      id = random || s.settings.nominationOrder === 'random' ? up[Math.floor(Math.random() * up.length)] : up[0];
    }
    this.openLot(room, id!, null);
  }

  private openLot(room: Room, playerId: string, nominatedBy: string | null) {
    const s = room.state;
    const p = this.player(playerId);
    if (!room.pool.includes(playerId)) fail('Player is not in this auction pool');
    const st = s.status[playerId];
    if (st && st !== 'unsold') fail(st === 'sold' ? `${p.name} has already been sold` : `${p.name} is not available`);
    clearTimeout(room.nextTimer);
    const lot: Lot = {
      no: ++s.lotCount, playerId, basePrice: this.base(room, playerId), bid: 0, bidder: null,
      endsAt: s.settings.timerSec ? Date.now() + s.settings.timerSec * 1000 : null, remainingMs: null, bids: [], nominatedBy, rtm: null,
    };
    s.lot = lot;
    s.status[playerId] = 'bidding';
    s.lastResult = null;
    store.lotOpened(s.code, lot.no, playerId, lot.basePrice);
    this.log(room, 'lot', `${p.name} is up for auction — base ${fmt(lot.basePrice)}${nominatedBy ? ` (nominated by ${this.tname(nominatedBy)})` : ''}`, { playerId });
    this.arm(room);
    this.commit(room);
  }

  private nominate(room: Room, pid: string, playerId: string) {
    const s = room.state;
    const t = this.myTeam(room, pid);
    if (t.r.nominations < 1) fail('You have no nominations available');
    if (s.phase !== 'auction' || s.paused) fail('The auction is not running');
    if (s.lot) fail('Wait for the current player to close');
    this.openLot(room, playerId, t.id);
    t.r.nominations--;
    this.commit(room);
  }

  private arm(room: Room) {
    clearTimeout(room.timer);
    const lot = room.state.lot;
    if (!lot || room.state.paused) return;
    const at = lot.rtm ? lot.rtm.endsAt : lot.endsAt;
    if (at == null) return;
    room.timer = setTimeout(() => {
      try {
        if (room.state.lot !== lot) return;
        if (lot.rtm) this.completeSale(room, lot.bidder!, 'auction');
        else this.hammer(room, !!lot.bidder);
      } catch (e) { console.error('[timer]', e); }
    }, Math.max(0, at - Date.now()));
  }

  /** Why a team may not bid right now, or null when it may. Shared by bid validation. */
  private bidBlock(room: Room, t: TeamState, amount: number): string | null {
    const s = room.state, lot = s.lot!, p = this.player(lot.playerId), r = t.r;
    if (lot.bidder === t.id) return 'You already hold the highest bid';
    if (r.skipRounds > 0) return 'A challenge bars you from bidding on this player';
    if (r.releaseFirst) return 'A challenge requires you to release a player before bidding';
    if (r.nextBuy === 'indian' && p.overseas) return 'A challenge limits your next purchase to an Indian player';
    if (r.nextBuy === 'overseas' && !p.overseas) return 'A challenge limits your next purchase to an overseas player';
    if (t.squad.length >= s.settings.maxSquad) return 'Your squad is full';
    if (p.overseas && this.overseas(t) >= s.settings.maxOverseas) return 'You have reached the overseas player limit';
    const min = minNextBid(lot, s.settings, t);
    if (amount < min) return `Minimum bid is ${fmt(min)}`;
    if (r.nextBuyMax != null && amount > r.nextBuyMax) return `A challenge caps your next purchase at ${fmt(r.nextBuyMax)}`;
    if (amount > t.purse) return 'That is more than your remaining purse';
    if (amount > maxBid(t, s.settings)) return `You must keep ${fmt(MIN_BASE)} for each remaining mandatory squad slot — your maximum bid is ${fmt(maxBid(t, s.settings))}`;
    return null;
  }

  private bid(room: Room, pid: string, amount: unknown) {
    const s = room.state, lot = s.lot;
    if (s.phase !== 'auction' || !lot) fail('No player is being auctioned right now');
    if (s.paused) fail('The auction is paused');
    if (lot!.rtm) fail('Bidding has closed for this player');
    const t = this.myTeam(room, pid);
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) fail('Invalid bid amount');
    const why = this.bidBlock(room, t, amt);
    if (why) fail(why);
    lot!.bid = amt;
    lot!.bidder = t.id;
    lot!.bids.push({ teamId: t.id, amount: amt, t: Date.now() });
    t.r.minRaise = 0;
    if (lot!.endsAt != null && s.settings.antiSnipeSec > 0) {
      lot!.endsAt = Math.max(lot!.endsAt, Date.now() + s.settings.antiSnipeSec * 1000);
    }
    store.bid(s.code, lot!.no, lot!.playerId, t.id, amt);
    this.log(room, 'bid', `${franchise(t.id)?.city} bid ${fmt(amt)} for ${this.player(lot!.playerId).name}`, { teamId: t.id, playerId: lot!.playerId });
    this.arm(room);
    this.commit(room);
  }

  /** Close the current lot: sold to the highest bidder, or unsold. */
  private hammer(room: Room, sell: boolean) {
    const s = room.state, lot = s.lot;
    if (!lot) fail('No player is being auctioned');
    if (lot!.rtm) fail('Waiting for the Right to Match decision');
    if (sell && !lot!.bidder) fail('There are no bids — mark the player unsold instead');
    if (!sell) return this.closeUnsold(room);
    // Right to Match: former franchises of the player may match the winning bid.
    if (s.settings.rtmEnabled) {
      const p = this.player(lot!.playerId);
      const eligible = Object.values(s.teams).filter((t) => t.id !== lot!.bidder && t.rtmLeft > 0 && t.ownerId && p.teams.includes(t.id)
        && lot!.bid <= maxBid(t, s.settings) && t.squad.length < s.settings.maxSquad && !(p.overseas && this.overseas(t) >= s.settings.maxOverseas)).map((t) => t.id);
      if (eligible.length) {
        lot!.rtm = { eligible, endsAt: Date.now() + s.settings.rtmWindowSec * 1000, price: lot!.bid };
        lot!.endsAt = null;
        this.log(room, 'rtm', `Right to Match window: ${eligible.join(', ')} can match ${fmt(lot!.bid)}`, { playerId: lot!.playerId });
        this.arm(room);
        return this.commit(room);
      }
    }
    this.completeSale(room, lot!.bidder!, 'auction');
  }

  private useRtm(room: Room, pid: string) {
    const lot = room.state.lot;
    const t = this.myTeam(room, pid);
    if (!lot?.rtm || !lot.rtm.eligible.includes(t.id)) fail('You cannot use Right to Match here');
    t.rtmLeft--;
    this.completeSale(room, t.id, 'rtm');
  }

  private completeSale(room: Room, teamId: string, via: 'auction' | 'rtm') {
    const s = room.state, lot = s.lot!;
    const t = s.teams[teamId] ?? fail('Team not found');
    const p = this.player(lot.playerId);
    // Final guards — these can never be bypassed from a browser.
    if (Object.values(s.teams).some((x) => x.squad.some((e) => e.playerId === p.id))) fail(`${p.name} has already been sold`);
    if (lot.bid > t.purse) fail('Winning team cannot afford the bid');
    t.purse -= lot.bid;
    t.squad.push({ playerId: p.id, price: lot.bid, via, protected: false });
    t.r.nextBuy = null; t.r.nextBuyMax = null;
    s.status[p.id] = 'sold';
    const sale: Sale = { id: randomUUID(), lotNo: lot.no, playerId: p.id, teamId, price: lot.bid, via, t: Date.now(), bids: lot.bids };
    s.sales.push(sale);
    store.sale(s.code, sale, t.purse, `${p.name}${via === 'rtm' ? ' (RTM)' : ''}`);
    s.lastResult = { playerId: p.id, outcome: 'sold', teamId, price: lot.bid, via, t: Date.now() };
    this.log(room, 'sold', `SOLD! ${p.name} to ${this.tname(teamId)} for ${fmt(lot.bid)}${via === 'rtm' ? ' using Right to Match' : ''}`, { teamId, playerId: p.id });
    room.state.salesSinceChallenge++;
    if (s.settings.challengesEnabled && s.settings.challengeEvery > 0 && room.state.salesSinceChallenge >= s.settings.challengeEvery) s.challengeDue = true;
    this.afterLot(room, lot);
  }

  private closeUnsold(room: Room) {
    const s = room.state, lot = s.lot!;
    s.status[lot.playerId] = 'unsold';
    store.lotClosed(s.code, lot.no, 'unsold');
    s.lastResult = { playerId: lot.playerId, outcome: 'unsold', t: Date.now() };
    this.log(room, 'unsold', `${this.player(lot.playerId).name} goes UNSOLD`, { playerId: lot.playerId });
    this.afterLot(room, lot);
  }

  /** Round-based challenge restrictions tick down when a lot finishes. */
  private afterLot(room: Room, lot: Lot) {
    const s = room.state;
    for (const t of Object.values(s.teams)) {
      if (t.r.skipRounds > 0) { t.r.skipRounds--; continue; }
      if (t.r.mustBid > 0) {
        if (!lot.bids.some((b) => b.teamId === t.id)) {
          const paid = -this.adjust(room, t, -t.r.mustBid, 'fine', 'Did not bid when a challenge required it');
          this.log(room, 'challenge', `${this.tname(t.id)} did not bid and pays a ${fmt(paid)} fine`, { teamId: t.id });
        }
        t.r.mustBid = 0;
      }
    }
    clearTimeout(room.timer);
    s.lot = null;
    this.scheduleNext(room);
    this.commit(room);
  }

  private challengeWaiting(room: Room) {
    const s = room.state;
    return s.challengeDue && s.settings.challengesEnabled;
  }

  private scheduleNext(room: Room) {
    clearTimeout(room.nextTimer);
    const s = room.state;
    if (this.challengeWaiting(room) && !s.run && (s.settings.spinBy === 'auto' || room.spinQueued)) return this.autoChallenge(room);
    if (!s.settings.autoNext || s.settings.nominationOrder === 'manual') return;
    room.nextTimer = setTimeout(() => {
      try {
        const nominating = Object.values(s.teams).some((t) => t.r.nominations > 0 && t.ownerId);
        if (s.phase === 'auction' && !s.paused && !s.lot && !s.run && !this.challengeWaiting(room) && !nominating && this.upcoming(room).length) this.openNext(room);
      } catch (e) { if (!(e instanceof Err)) console.error('[auto-next]', e); }
    }, AUTO_NEXT_MS);
  }

  private skip(room: Room, pid: string) {
    this.host(room, pid);
    const s = room.state, lot = s.lot;
    if (!lot) fail('No player is being auctioned');
    if (lot!.rtm) fail('Waiting for the Right to Match decision');
    delete s.status[lot!.playerId];
    room.pool = [...room.pool.filter((id) => id !== lot!.playerId), lot!.playerId]; // back of the queue
    store.lotClosed(s.code, lot!.no, 'skipped');
    this.log(room, 'lot', `${this.player(lot!.playerId).name} was skipped and will return later`, { playerId: lot!.playerId });
    clearTimeout(room.timer);
    s.lot = null;
    this.scheduleNext(room);
    this.commit(room, true);
  }

  private pause(room: Room, emergency: boolean) {
    const s = room.state;
    if (s.phase !== 'auction') fail('The auction is not running');
    clearTimeout(room.timer); clearTimeout(room.nextTimer);
    const lot = s.lot;
    if (emergency && lot) {
      // Emergency stop voids the lot entirely; all bids on it are discarded and the player returns to the pool.
      delete s.status[lot.playerId];
      store.lotClosed(s.code, lot.no, 'cancelled');
      s.lot = null;
    } else if (lot) {
      if (lot.rtm) { lot.remainingMs = Math.max(0, lot.rtm.endsAt - Date.now()); }
      else if (lot.endsAt != null) { lot.remainingMs = Math.max(0, lot.endsAt - Date.now()); lot.endsAt = null; }
    }
    if (s.paused && !emergency) return;
    s.paused = true;
    this.log(room, 'phase', emergency ? 'EMERGENCY STOP — the current lot was voided and the auction is frozen' : 'Auction paused');
    this.commit(room);
  }

  private resume(room: Room, pid: string) {
    this.host(room, pid);
    const s = room.state, lot = s.lot;
    if (!s.paused) return;
    s.paused = false;
    if (lot && lot.remainingMs != null) {
      if (lot.rtm) lot.rtm.endsAt = Date.now() + lot.remainingMs; else lot.endsAt = Date.now() + Math.max(lot.remainingMs, 3000);
      lot.remainingMs = null;
    }
    this.log(room, 'phase', 'Auction resumed');
    this.arm(room);
    if (!lot) this.scheduleNext(room);
    this.commit(room);
  }

  private undo(room: Room, pid: string) {
    this.host(room, pid);
    const s = room.state;
    if (s.lot) fail('Close the current player before undoing a sale');
    const sale = s.sales[s.sales.length - 1] ?? fail('There is no sale to undo');
    const t = s.teams[sale.teamId];
    const entry = t?.squad.find((e) => e.playerId === sale.playerId) ?? fail('That player is no longer in the buying squad, so the sale cannot be undone');
    clearTimeout(room.nextTimer);
    t.squad = t.squad.filter((e) => e !== entry);
    t.purse += sale.price;
    if (sale.via === 'rtm') t.rtmLeft++;
    delete s.status[sale.playerId];
    s.sales.pop();
    s.lastResult = null;
    room.state.salesSinceChallenge = Math.max(0, room.state.salesSinceChallenge - 1);
    store.removal(s.code, { franchise: t.id, playerId: sale.playerId, refund: sale.price, balanceAfter: t.purse, type: 'undo', note: `Undo sale of ${this.player(sale.playerId).name}`, saleId: sale.id, lotNo: sale.lotNo });
    this.log(room, 'undo', `Host reversed the sale of ${this.player(sale.playerId).name} — ${fmt(sale.price)} returned to ${this.tname(t.id)}`, { teamId: t.id, playerId: sale.playerId });
    this.commit(room);
  }

  private reauction(room: Room, pid: string) {
    this.host(room, pid);
    const s = room.state;
    if (!s.settings.reauctionUnsold) fail('Re-auction of unsold players is disabled in the room settings');
    const ids = Object.keys(s.status).filter((id) => s.status[id] === 'unsold');
    if (!ids.length) fail('There are no unsold players');
    ids.forEach((id) => delete s.status[id]);
    room.pool = [...room.pool.filter((id) => !ids.includes(id)), ...ids];
    this.log(room, 'phase', `${ids.length} unsold players return for an accelerated round`);
    this.scheduleNext(room);
    this.commit(room, true);
  }

  private end(room: Room, pid: string) {
    this.host(room, pid);
    const s = room.state;
    if (s.phase === 'ended' || s.phase === 'lobby') fail('Nothing to end');
    if (s.lot) fail('Close the current player first');
    clearTimeout(room.timer); clearTimeout(room.nextTimer);
    s.phase = 'ended'; s.paused = false; s.run = null;
    this.log(room, 'phase', 'The auction has ended — results are in!');
    this.commit(room);
  }

  // ---------------------------------------------------------------- releases
  private release(room: Room, t: TeamState, playerId: string, refundPct: number, why: string) {
    const s = room.state;
    const e = t.squad.find((x) => x.playerId === playerId) ?? fail('Player is not in that squad');
    t.squad = t.squad.filter((x) => x !== e);
    const refund = Math.round((e.price * refundPct) / 100);
    t.purse += refund;
    s.status[playerId] = 'unsold'; // back in the pool for the re-auction round
    store.removal(s.code, { franchise: t.id, playerId, refund, balanceAfter: t.purse, type: 'release_refund', note: `${why}: released ${this.player(playerId).name}` });
    this.log(room, 'release', `${this.tname(t.id)} released ${this.player(playerId).name}${refund ? ` and recovered ${fmt(refund)}` : ''}`, { teamId: t.id, playerId });
    return refund;
  }

  private voluntaryRelease(room: Room, pid: string, playerId: string) {
    const t = this.myTeam(room, pid);
    if (!t.r.releaseFirst) fail('You can only release a player when a challenge requires it');
    if (room.state.lot?.bidder === t.id) fail('You hold the current highest bid');
    this.release(room, t, playerId, room.state.settings.releaseRefundPct, 'Challenge');
    t.r.releaseFirst = false;
    this.commit(room);
  }

  // ---------------------------------------------------------------- challenge arena
  private saveChallenge(room: Room, pid: string, c: Partial<ChallengeDef>) {
    this.host(room, pid);
    const s = room.state;
    const effects: EffectType[] = ['budget', 'release_expensive', 'release_top', 'release_random', 'skip', 'must_bid', 'next_indian', 'next_overseas', 'next_max_price', 'nominate', 'min_raise', 'release_first', 'swap', 'target_budget', 'target_skip', 'protect', 'none'];
    const cur = s.challenges.find((x) => x.id === c?.id);
    const next: ChallengeDef = {
      id: cur?.id ?? `c${randomBytes(4).toString('hex')}`,
      category: cur?.category ?? 'Custom',
      text: clean(c?.text ?? cur?.text, 120) || fail('Challenge needs a description'),
      effect: effects.includes(c?.effect as EffectType) ? (c!.effect as EffectType) : cur?.effect ?? 'none',
      amount: Math.max(-5000, Math.min(5000, Math.round(Number(c?.amount ?? cur?.amount ?? 0)) || 0)),
      weight: Math.max(0.1, Math.min(10, Number(c?.weight ?? cur?.weight ?? 1) || 1)),
      enabled: c?.enabled ?? cur?.enabled ?? true,
    };
    if (cur) Object.assign(cur, next); else { if (s.challenges.length >= 80) fail('Too many challenges'); s.challenges.push(next); }
    this.commit(room);
  }

  private arenaLive(room: Room) {
    const s = room.state;
    if (!s.settings.challengesEnabled) fail('Challenges are disabled in the room settings');
    if (s.phase !== 'auction') fail('Challenges are available once the auction is live');
  }

  /** Host-only arena actions (manual assign, surprise event) need a quiet moment between players. */
  private arenaOpen(room: Room, pid: string) {
    this.host(room, pid);
    this.arenaLive(room);
    if (room.state.lot) fail('Finish the current player before starting a challenge');
  }

  /** The host may always spin. In rotation mode the team whose turn it is may spin once a challenge is due. */
  private canSpin(room: Room, pid: string) {
    const s = room.state;
    if (pid === s.hostId) return;
    if (s.settings.spinBy !== 'rotation') fail(s.settings.spinBy === 'auto' ? 'The wheels spin automatically in this room' : 'Only the host can spin the wheels in this room');
    const turn = spinTurnTeam(s);
    if (!turn || s.teams[turn].ownerId !== pid) fail(`It is ${turn ? this.tname(turn) : 'another team'}'s turn to spin`);
    if (!s.challengeDue) fail(`Your spin unlocks after ${s.settings.challengeEvery || 'more'} players are sold`);
  }

  private spinTeam(room: Room, pid: string) {
    this.arenaLive(room);
    this.canSpin(room, pid);
    const s = room.state;
    if (s.run && pid !== s.hostId) fail('The team wheel has already been spun');
    if (s.lot) { // queue it: the wheels spin as soon as this player is closed
      if (room.spinQueued) fail('A spin is already queued for after this player');
      room.spinQueued = true;
      s.challengeDue = true;
      this.log(room, 'challenge', 'Challenge queued — the wheels spin as soon as this player is closed');
      return this.commit(room);
    }
    this.doSpinTeam(room);
  }

  private autoChallenge(room: Room) {
    clearTimeout(room.nextTimer);
    room.nextTimer = setTimeout(() => {
      try {
        const s = room.state;
        if (s.phase !== 'auction' || s.paused || s.lot || s.run || !this.challengeWaiting(room)) return;
        room.spinQueued = false;
        this.log(room, 'challenge', 'Challenge time! The wheels are spinning…');
        this.doSpinTeam(room);
        room.nextTimer = setTimeout(() => {
          try { if (room.state.run?.stage === 'team' && !room.state.lot && !room.state.paused) this.doSpinChallenge(room); }
          catch (e) { if (!(e instanceof Err)) console.error('[auto-challenge]', e); }
        }, WHEEL_MS);
      } catch (e) { if (!(e instanceof Err)) console.error('[auto-challenge]', e); }
    }, AUTO_SPIN_DELAY_MS);
  }

  private doSpinTeam(room: Room) {
    const s = room.state;
    if (s.run && s.run.stage !== 'team') fail('Resolve the current challenge first');
    const options = Object.keys(s.teams);
    if (!options.length) fail('No teams in this auction');
    const index = Math.floor(Math.random() * options.length);
    s.teamWheel = { nonce: Date.now(), options, index };
    s.challengeWheel = null;
    s.run = { id: randomUUID(), teamId: options[index], challengeId: null, stage: 'team' };
    this.commit(room);
  }

  private spinChallenge(room: Room, pid: string) {
    this.arenaLive(room);
    this.canSpin(room, pid);
    if (room.state.lot) fail('Finish the current player first');
    this.doSpinChallenge(room);
  }

  private doSpinChallenge(room: Room) {
    const s = room.state;
    if (!s.run || s.run.stage !== 'team' || !s.run.teamId) fail('Spin the team wheel first');
    let opts = s.challenges.filter((c) => c.enabled && (s.settings.challengeRepeat || !s.usedChallenges.includes(c.id)));
    if (!opts.length && !s.settings.challengeRepeat) { s.usedChallenges = []; opts = s.challenges.filter((c) => c.enabled); }
    if (!opts.length) fail('No challenges are enabled');
    let roll = Math.random() * opts.reduce((a, c) => a + c.weight, 0);
    let index = opts.findIndex((c) => (roll -= c.weight) < 0);
    if (index < 0) index = opts.length - 1;
    s.challengeWheel = { nonce: Date.now(), options: opts.map((c) => c.id), index };
    this.beginChallenge(room, opts[index]);
  }

  private assignChallenge(room: Room, pid: string, teamId: string, challengeId: string) {
    this.arenaOpen(room, pid);
    const s = room.state;
    if (s.run && s.run.stage !== 'team') fail('Resolve the current challenge first');
    if (!s.teams[teamId]) fail('Unknown team');
    const c = s.challenges.find((x) => x.id === challengeId) ?? fail('Unknown challenge');
    s.run = { id: randomUUID(), teamId, challengeId: null, stage: 'team' };
    s.teamWheel = null; s.challengeWheel = null;
    this.beginChallenge(room, c);
  }

  private surprise(room: Room, pid: string) {
    this.arenaOpen(room, pid);
    this.doSpinTeam(room);
    this.doSpinChallenge(room);
  }

  private beginChallenge(room: Room, c: ChallengeDef) {
    const s = room.state, run = s.run!;
    run.challengeId = c.id;
    s.usedChallenges.push(c.id);
    s.challengeDue = false;
    room.spinQueued = false;
    room.state.salesSinceChallenge = 0;
    if (s.settings.spinBy === 'rotation') s.spinTurn = (s.spinTurn ?? 0) + 1;
    this.log(room, 'challenge', `Challenge for ${this.tname(run.teamId!)}: ${c.text}`, { teamId: run.teamId! });
    if (s.settings.challengeMode === 'optional') { run.stage = 'accept'; this.commit(room); }
    else this.resolve(room);
  }

  private runActor(room: Room, pid: string, teamId: string) {
    if (pid !== room.state.hostId && room.state.teams[teamId]?.ownerId !== pid) fail('This decision belongs to the challenged team');
  }

  private respondChallenge(room: Room, pid: string, accept: boolean) {
    const run = room.state.run;
    if (!run || run.stage !== 'accept') fail('Nothing to respond to');
    this.runActor(room, pid, run!.teamId!);
    if (!accept) return this.finishRun(room, 'rejected', 'The team declined the challenge');
    this.resolve(room);
  }

  private resolve(room: Room) {
    const s = room.state, run = s.run!;
    const c = s.challenges.find((x) => x.id === run.challengeId)!;
    const t = s.teams[run.teamId!];
    const needsInput = TEAM_FX.includes(c.effect) || c.effect === 'swap' || c.effect === 'protect';
    if (needsInput) {
      const others = Object.values(s.teams).filter((x) => x.id !== t.id);
      if (c.effect === 'protect' && !t.squad.some((e) => !e.protected)) return this.finishRun(room, 'no effect', 'No player available to protect');
      if (c.effect === 'swap' && (!t.squad.length || !others.some((o) => o.squad.length))) return this.finishRun(room, 'no effect', 'Not enough players for a swap');
      run.stage = 'input';
      return this.commit(room);
    }
    this.apply(room, c, t);
  }

  private challengeInput(room: Room, pid: string, a: any) {
    const s = room.state, run = s.run;
    if (!run || run.stage !== 'input') fail('No input is expected');
    this.runActor(room, pid, run!.teamId!);
    const c = s.challenges.find((x) => x.id === run!.challengeId)!;
    const t = s.teams[run!.teamId!];
    if (a.pass) return this.finishRun(room, 'no effect', 'The team passed');
    if (TEAM_FX.includes(c.effect)) {
      const target = s.teams[a.targetTeam];
      if (!target || target.id === t.id) fail('Choose an opponent');
      if (c.effect === 'target_budget') {
        const d = this.adjust(room, target, c.amount, 'challenge', `Targeted by ${this.tname(t.id)}: ${c.text}`);
        return this.finishRun(room, 'applied', `${this.tname(target.id)} ${d < 0 ? 'lost' : 'gained'} ${fmt(Math.abs(d))}`, 0);
      }
      target.r.skipRounds += Math.max(1, c.amount || 1);
      return this.finishRun(room, 'applied', `${this.tname(target.id)} cannot bid on the next player`);
    }
    if (c.effect === 'protect') {
      const e = t.squad.find((x) => x.playerId === a.playerId) ?? fail('Choose one of your players');
      e.protected = true;
      return this.finishRun(room, 'applied', `${this.player(e.playerId).name} is protected from release`);
    }
    if (c.effect === 'swap') {
      const target = s.teams[a.targetTeam];
      if (!target || target.id === t.id) fail('Choose an opponent');
      if (!t.squad.some((e) => e.playerId === a.myPlayer) || !target.squad.some((e) => e.playerId === a.theirPlayer)) fail('Choose one player from each squad');
      this.checkSwap(room, t, target, a.myPlayer, a.theirPlayer);
      run!.swap = { myPlayer: a.myPlayer, targetTeam: target.id, theirPlayer: a.theirPlayer };
      run!.stage = 'swap_confirm';
      return this.commit(room);
    }
  }

  private checkSwap(room: Room, a: TeamState, b: TeamState, pa: string, pb: string) {
    const max = room.state.settings.maxOverseas;
    const oa = this.player(pa).overseas, ob = this.player(pb).overseas;
    if (!oa && ob && this.overseas(a) >= max) fail(`${this.tname(a.id)} would exceed the overseas limit`);
    if (oa && !ob && this.overseas(b) >= max) fail(`${this.tname(b.id)} would exceed the overseas limit`);
  }

  private swapRespond(room: Room, pid: string, accept: boolean) {
    const s = room.state, run = s.run;
    if (!run || run.stage !== 'swap_confirm' || !run.swap) fail('No swap is waiting');
    const { myPlayer, targetTeam, theirPlayer } = run!.swap!;
    this.runActor(room, pid, targetTeam);
    if (!accept) return this.finishRun(room, 'rejected', `${this.tname(targetTeam)} declined the swap`);
    const a = s.teams[run!.teamId!], b = s.teams[targetTeam];
    const ea = a.squad.find((e) => e.playerId === myPlayer), eb = b.squad.find((e) => e.playerId === theirPlayer);
    if (!ea || !eb) return this.finishRun(room, 'no effect', 'One of the players is no longer available');
    this.checkSwap(room, a, b, myPlayer, theirPlayer);
    a.squad = a.squad.map((e) => (e === ea ? { ...eb, via: 'swap' as const } : e));
    b.squad = b.squad.map((e) => (e === eb ? { ...ea, via: 'swap' as const } : e));
    store.swap(s.code, { franchise: a.id, playerId: myPlayer }, { franchise: b.id, playerId: theirPlayer });
    this.finishRun(room, 'applied', `${this.player(myPlayer).name} ⇄ ${this.player(theirPlayer).name} with ${this.tname(b.id)}`);
  }

  /** Applies a challenge that needs no further input. Everything here changes real auction state. */
  private apply(room: Room, c: ChallengeDef, t: TeamState) {
    const s = room.state;
    const releasable = t.squad.filter((e) => !e.protected);
    switch (c.effect) {
      case 'budget': {
        const d = this.adjust(room, t, c.amount, 'challenge', c.text);
        return this.finishRun(room, d === 0 && c.amount !== 0 ? 'no effect' : 'applied', `Purse ${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))} → ${fmt(t.purse)}`, d);
      }
      case 'release_expensive': case 'release_top': case 'release_random': {
        if (!releasable.length) return this.finishRun(room, 'no effect', t.squad.length ? 'Every player is protected' : 'Squad is empty — nothing to release');
        const pick = c.effect === 'release_expensive' ? [...releasable].sort((a, b) => b.price - a.price)[0]
          : c.effect === 'release_top' ? [...releasable].sort((a, b) => this.player(b.playerId).matches - this.player(a.playerId).matches)[0]
            : releasable[Math.floor(Math.random() * releasable.length)];
        const refund = this.release(room, t, pick.playerId, s.settings.releaseRefundPct, 'Challenge');
        return this.finishRun(room, 'applied', `Released ${this.player(pick.playerId).name}${refund ? `, refund ${fmt(refund)}` : ''}`, refund, [pick.playerId]);
      }
      case 'skip': t.r.skipRounds += Math.max(1, c.amount || 1); return this.finishRun(room, 'applied', `Barred from the next ${Math.max(1, c.amount || 1)} bidding round(s)`);
      case 'must_bid': t.r.mustBid = Math.max(1, Math.abs(c.amount) || 100); return this.finishRun(room, 'applied', `Must bid on the next player or pay ${fmt(t.r.mustBid)}`);
      case 'next_indian': t.r.nextBuy = 'indian'; return this.finishRun(room, 'applied', 'Can only bid on Indian players until the next purchase');
      case 'next_overseas': t.r.nextBuy = 'overseas'; return this.finishRun(room, 'applied', 'Can only bid on overseas players until the next purchase');
      case 'next_max_price': t.r.nextBuyMax = Math.max(MIN_BASE, Math.abs(c.amount) || 500); return this.finishRun(room, 'applied', `Next purchase capped at ${fmt(t.r.nextBuyMax)}`);
      case 'min_raise': t.r.minRaise = Math.max(10, Math.abs(c.amount) || 100); return this.finishRun(room, 'applied', `Next bid must raise by an extra ${fmt(t.r.minRaise)}`);
      case 'nominate': t.r.nominations += Math.max(1, c.amount || 1); return this.finishRun(room, 'applied', 'Earned a nomination — pick the next player from the catalogue');
      case 'release_first':
        if (!t.squad.length) return this.finishRun(room, 'no effect', 'Squad is empty — nothing to release');
        t.r.releaseFirst = true;
        return this.finishRun(room, 'applied', 'Must release a player before bidding again');
      default: {
        const d = c.amount ? this.adjust(room, t, c.amount, 'challenge', c.text) : 0;
        return this.finishRun(room, 'applied', d ? `Purse ${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}` : 'Assigned — the host confirms completion', d);
      }
    }
  }

  private finishRun(room: Room, status: ChallengeLog['status'], result: string, budgetDelta = 0, released: string[] = []) {
    const s = room.state, run = s.run!;
    const c = s.challenges.find((x) => x.id === run.challengeId);
    const entry: ChallengeLog = { id: run.id, t: Date.now(), teamId: run.teamId!, text: c?.text ?? 'Challenge', status, result, budgetDelta, released };
    s.challengeLog.push(entry);
    store.challenge(s.code, entry);
    this.log(room, 'challenge', `${this.tname(run.teamId!)} — ${result}`, { teamId: run.teamId! });
    s.run = null;
    this.scheduleNext(room);
    this.commit(room);
  }

  // ---------------------------------------------------------------- restore after restart
  restore(snapshot: string) {
    const snap = JSON.parse(snapshot);
    const state: RoomState = snap.state;
    state.participants.forEach((p) => (p.connected = false));
    state.settings = sanitizeSettings(defaultSettings(state.settings.format), state.settings);
    state.salesSinceChallenge ??= 0;
    state.spinTurn ??= 0;
    if (state.lot) { // timers died with the old process: freeze the clock so the host can resume
      const lot = state.lot;
      lot.remainingMs = Math.max(5000, (lot.rtm ? lot.rtm.endsAt : lot.endsAt ?? 0) - Date.now());
      if (!lot.rtm) lot.endsAt = null;
      state.paused = true;
    }
    const room: Room = {
      state, pool: snap.pool, secrets: new Map(snap.secrets), wishlists: new Map(snap.wishlists),
      logSeq: state.log.reduce((m, e) => Math.max(m, e.id), 0),
    };
    this.rooms.set(state.code, room);
  }
}

function clean(v: unknown, max: number) {
  return String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}
