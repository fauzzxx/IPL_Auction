// Types and small pure helpers shared by the server and the client.
// All money values are integers in LAKHS (₹120 Cr = 12000).

export type Role = 'BAT' | 'WK' | 'AR' | 'BOWL';
export type PlayerStatus = 'upcoming' | 'bidding' | 'sold' | 'unsold' | 'withdrawn';

export interface PlayerStats {
  runs: number; balls: number; outs: number; highScore: number; fours: number; sixes: number;
  wickets: number; ballsBowled: number; runsConceded: number; catches: number; stumpings: number;
}

export interface Player {
  id: string;
  name: string;
  shortName: string;
  fullName: string | null;
  nationality: string;
  overseas: boolean;
  role: Role;
  secondaryRole: string | null;
  roleSource: string;
  battingStyle: string | null;
  bowlingStyle: string | null;
  bowlingType: string | null;
  battingPosition: string | null;
  teams: string[];
  seasons: number[];
  matches: number;
  active: boolean;
  lastSeason: number;
  stats: PlayerStats;
  basePrice: number;
  historicalBasePrice: number | null;
  photo: string | null;
  dob: string | null;
  wikipedia: string | null;
}

export interface Franchise { id: string; name: string; city: string; color: string; color2: string; text: string }

export const FRANCHISES: Franchise[] = [
  { id: 'CSK', name: 'Chennai Super Kings', city: 'Chennai', color: '#FDB913', color2: '#1C4E9F', text: '#111' },
  { id: 'MI', name: 'Mumbai Indians', city: 'Mumbai', color: '#0A6EC8', color2: '#D1AB3E', text: '#fff' },
  { id: 'RCB', name: 'Royal Challengers Bengaluru', city: 'Bengaluru', color: '#E01F2D', color2: '#C9A227', text: '#fff' },
  { id: 'KKR', name: 'Kolkata Knight Riders', city: 'Kolkata', color: '#5B2D91', color2: '#F2C028', text: '#fff' },
  { id: 'RR', name: 'Rajasthan Royals', city: 'Rajasthan', color: '#EA1A85', color2: '#254AA5', text: '#fff' },
  { id: 'SRH', name: 'Sunrisers Hyderabad', city: 'Hyderabad', color: '#F26522', color2: '#111111', text: '#fff' },
  { id: 'DC', name: 'Delhi Capitals', city: 'Delhi', color: '#2561AE', color2: '#EF1B23', text: '#fff' },
  { id: 'PBKS', name: 'Punjab Kings', city: 'Punjab', color: '#DD1F2D', color2: '#C0C0C0', text: '#fff' },
  { id: 'GT', name: 'Gujarat Titans', city: 'Gujarat', color: '#1B2A4A', color2: '#C8A44D', text: '#fff' },
  { id: 'LSG', name: 'Lucknow Super Giants', city: 'Lucknow', color: '#1FA5E0', color2: '#F28B00', text: '#fff' },
];
export const franchise = (id: string | null | undefined) => FRANCHISES.find((f) => f.id === id);

export const DEFUNCT: Record<string, string> = {
  DCH: 'Deccan Chargers', GL: 'Gujarat Lions', PWI: 'Pune Warriors India', RPS: 'Rising Pune Supergiant', KTK: 'Kochi Tuskers Kerala',
};
export const teamName = (id: string) => franchise(id)?.name ?? DEFUNCT[id] ?? id;

export type AuctionFormat = 'mega' | 'mini' | 'legends' | 'alltime' | 'custom';
export type NominationOrder = 'marquee' | 'sets' | 'random' | 'manual';

export interface Settings {
  format: AuctionFormat;
  maxTeams: number;
  purse: number;
  minSquad: number;
  maxSquad: number;
  maxOverseas: number;
  increments: number[];
  timerSec: number; // 0 = no countdown, host closes manually
  antiSnipeSec: number; // a bid with less than this left resets the clock to this value (0 = off)
  nominationOrder: NominationOrder;
  autoNext: boolean;
  reauctionUnsold: boolean;
  challengesEnabled: boolean;
  challengeEvery: number; // prompt a challenge every N sales (0 = host decides)
  challengeMode: 'mandatory' | 'optional';
  spinBy: 'auto' | 'host' | 'rotation'; // who spins when a challenge is due
  challengeRepeat: boolean;
  releaseRefundPct: number;
  retentionEnabled: boolean;
  maxRetentions: number;
  retentionCosts: number[];
  rtmEnabled: boolean;
  rtmCards: number;
  rtmWindowSec: number;
  poolMinMatches: number; // custom format pool filters
  poolStatus: 'all' | 'active' | 'former';
}

export interface Restrictions {
  skipRounds: number;
  mustBid: number; // fine (lakhs) applied if the team does not bid on the next player; 0 = none
  nextBuy: null | 'indian' | 'overseas';
  nextBuyMax: number | null;
  minRaise: number;
  releaseFirst: boolean;
  nominations: number;
}

export interface SquadEntry { playerId: string; price: number; via: 'auction' | 'retention' | 'rtm' | 'swap'; protected: boolean }

export interface TeamState {
  id: string;
  ownerId: string | null;
  initialPurse: number;
  purse: number;
  squad: SquadEntry[];
  rtmLeft: number;
  r: Restrictions;
}

export interface Participant { id: string; name: string; teamId: string | null; connected: boolean; isHost: boolean }

export interface BidRecord { teamId: string; amount: number; t: number }

export interface Lot {
  no: number;
  playerId: string;
  basePrice: number;
  bid: number;
  bidder: string | null;
  endsAt: number | null;
  remainingMs: number | null; // set while paused
  bids: BidRecord[];
  nominatedBy: string | null;
  rtm: null | { eligible: string[]; endsAt: number; price: number };
}

export interface Sale { id: string; lotNo: number; playerId: string; teamId: string; price: number; via: 'auction' | 'rtm' | 'retention'; t: number; bids: BidRecord[] }

export type EffectType =
  | 'budget' | 'release_expensive' | 'release_top' | 'release_random' | 'skip' | 'must_bid'
  | 'next_indian' | 'next_overseas' | 'next_max_price' | 'nominate' | 'min_raise' | 'release_first'
  | 'swap' | 'target_budget' | 'target_skip' | 'protect' | 'none';

export interface ChallengeDef {
  id: string;
  category: 'Budget' | 'Player' | 'Auction' | 'Random' | 'Custom';
  text: string;
  effect: EffectType;
  amount: number;
  weight: number;
  enabled: boolean;
}

export interface ChallengeRun {
  id: string;
  teamId: string | null;
  challengeId: string | null;
  stage: 'team' | 'accept' | 'input' | 'swap_confirm';
  swap?: { myPlayer: string; targetTeam: string; theirPlayer: string };
}

export interface ChallengeLog {
  id: string; t: number; teamId: string; text: string;
  status: 'applied' | 'rejected' | 'no effect' | 'cancelled';
  result: string; budgetDelta: number; released: string[];
}

export interface WheelSpin { nonce: number; options: string[]; index: number }

export interface LogEvent { id: number; t: number; kind: string; text: string; teamId?: string; playerId?: string; by?: string }

export interface RoomState {
  code: string;
  name: string;
  hostId: string;
  phase: 'lobby' | 'retention' | 'auction' | 'ended';
  paused: boolean;
  settings: Settings;
  participants: Participant[];
  teams: Record<string, TeamState>;
  status: Record<string, PlayerStatus>; // only players that are not 'upcoming'
  baseOverrides: Record<string, number>;
  poolSize: number;
  poolVersion: number;
  lot: Lot | null;
  lotCount: number;
  lastResult: null | { playerId: string; outcome: 'sold' | 'unsold'; teamId?: string; price?: number; via?: string; t: number };
  sales: Sale[];
  challenges: ChallengeDef[];
  run: ChallengeRun | null;
  challengeLog: ChallengeLog[];
  usedChallenges: string[];
  challengeDue: boolean;
  salesSinceChallenge: number;
  spinTurn: number; // rotation mode: index into the team order
  teamWheel: WheelSpin | null;
  challengeWheel: WheelSpin | null;
  log: LogEvent[];
  serverNow: number;
}

export interface MeState { participantId: string; wishlist: string[] }

export const MIN_BASE = 30;

/** Rotation mode: which franchise spins next. */
export const spinTurnTeam = (s: RoomState): string | null => {
  const ids = Object.keys(s.teams);
  return ids.length ? ids[(s.spinTurn ?? 0) % ids.length] : null;
};

export const fmt = (lakhs: number): string => {
  const neg = lakhs < 0 ? '-' : '';
  const v = Math.abs(lakhs);
  if (v >= 100) {
    const cr = v / 100;
    return `${neg}₹${Number.isInteger(cr) ? cr : cr.toFixed(2).replace(/0$/, '')} Cr`;
  }
  return `${neg}₹${v} L`;
};

export const ROLE_LABEL: Record<Role, string> = { BAT: 'Batter', WK: 'Wicketkeeper', AR: 'All-rounder', BOWL: 'Bowler' };

export const overseasCount = (t: TeamState, players: Map<string, Player> | Record<string, Player>) =>
  t.squad.filter((s) => (players instanceof Map ? players.get(s.playerId) : players[s.playerId])?.overseas).length;

/** Highest bid a team may place while still being able to fill its mandatory squad slots at the minimum base price. */
export const maxBid = (t: TeamState, s: Settings) => Math.max(0, t.purse - Math.max(0, s.minSquad - t.squad.length - 1) * MIN_BASE);

export const minNextBid = (lot: Lot, s: Settings, t?: TeamState) =>
  (lot.bidder ? lot.bid + Math.min(...s.increments) : lot.basePrice) + (lot.bidder && t ? t.r.minRaise : 0);

export const stat = {
  avg: (p: Player) => (p.stats.outs ? p.stats.runs / p.stats.outs : p.stats.runs),
  sr: (p: Player) => (p.stats.balls ? (p.stats.runs / p.stats.balls) * 100 : 0),
  econ: (p: Player) => (p.stats.ballsBowled ? (p.stats.runsConceded / p.stats.ballsBowled) * 6 : 0),
};
