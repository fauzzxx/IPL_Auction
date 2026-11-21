import type { AuctionFormat, ChallengeDef, Player, Settings } from '../../shared/types.js';

export function defaultSettings(format: AuctionFormat = 'mega'): Settings {
  const base: Settings = {
    format, maxTeams: 10, purse: 12000, minSquad: 18, maxSquad: 25, maxOverseas: 8,
    increments: [10, 20, 25, 50, 100], timerSec: 20, antiSnipeSec: 8,
    nominationOrder: 'marquee', autoNext: true, reauctionUnsold: true,
    challengesEnabled: true, challengeEvery: 5, challengeMode: 'mandatory', spinBy: 'auto', challengeRepeat: true, releaseRefundPct: 50,
    retentionEnabled: false, maxRetentions: 4, retentionCosts: [1800, 1400, 1100, 800],
    rtmEnabled: false, rtmCards: 1, rtmWindowSec: 10, poolMinMatches: 0, poolStatus: 'all',
  };
  if (format === 'mini') return { ...base, minSquad: 11, maxSquad: 15, maxOverseas: 5 };
  if (format === 'legends') return { ...base, minSquad: 11, maxSquad: 18, maxOverseas: 6 };
  if (format === 'alltime') return { ...base, minSquad: 15, maxSquad: 25 };
  return base;
}

export const FORMAT_INFO: Record<AuctionFormat, string> = {
  mega: 'Everyone who played in the last three IPL seasons',
  mini: 'Only players from the most recent IPL season, smaller squads',
  legends: 'Former IPL players with 50+ appearances',
  alltime: 'Every player in IPL history, 2008 to today',
  custom: 'Choose your own pool filters and rules',
};

const int = (v: unknown, min: number, max: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

/** Server-side sanitising of host-supplied settings: every field is clamped to a sane range. */
export function sanitizeSettings(cur: Settings, patch: Partial<Settings>): Settings {
  const m = { ...cur, ...patch };
  const formats = ['mega', 'mini', 'legends', 'alltime', 'custom'];
  const s: Settings = {
    format: formats.includes(m.format) ? m.format : cur.format,
    maxTeams: int(m.maxTeams, 2, 10, 10),
    purse: int(m.purse, 500, 100000, 12000),
    minSquad: int(m.minSquad, 1, 30, 18),
    maxSquad: int(m.maxSquad, 1, 40, 25),
    maxOverseas: int(m.maxOverseas, 0, 40, 8),
    increments: [...new Set((Array.isArray(m.increments) ? m.increments : cur.increments).map((x) => int(x, 5, 2000, 0)).filter(Boolean))].sort((a, b) => a - b).slice(0, 6),
    timerSec: int(m.timerSec, 0, 300, 20),
    antiSnipeSec: int(m.antiSnipeSec, 0, 60, 8),
    nominationOrder: ['marquee', 'sets', 'random', 'manual'].includes(m.nominationOrder) ? m.nominationOrder : 'marquee',
    autoNext: !!m.autoNext, reauctionUnsold: !!m.reauctionUnsold,
    challengesEnabled: !!m.challengesEnabled, challengeEvery: int(m.challengeEvery, 0, 50, 5),
    challengeMode: m.challengeMode === 'optional' ? 'optional' : 'mandatory', challengeRepeat: !!m.challengeRepeat,
    spinBy: ['auto', 'host', 'rotation'].includes(m.spinBy) ? m.spinBy : 'auto',
    releaseRefundPct: int(m.releaseRefundPct, 0, 100, 50),
    retentionEnabled: !!m.retentionEnabled, maxRetentions: int(m.maxRetentions, 0, 10, 4),
    retentionCosts: (Array.isArray(m.retentionCosts) ? m.retentionCosts : cur.retentionCosts).map((x) => int(x, 0, 10000, 1000)).slice(0, 10),
    rtmEnabled: !!m.rtmEnabled, rtmCards: int(m.rtmCards, 0, 5, 1), rtmWindowSec: int(m.rtmWindowSec, 5, 60, 10),
    poolMinMatches: int(m.poolMinMatches, 0, 300, 0),
    poolStatus: ['all', 'active', 'former'].includes(m.poolStatus) ? m.poolStatus : 'all',
  };
  if (!s.increments.length) s.increments = [10, 20, 25, 50, 100];
  if (!s.retentionCosts.length) s.retentionCosts = [1800];
  if (s.maxSquad < s.minSquad) s.maxSquad = s.minSquad;
  return s;
}

const ROLE_ORDER = { BAT: 0, AR: 1, WK: 2, BOWL: 3 } as const;

export function buildPool(players: Player[], s: Settings): string[] {
  const latest = Math.max(...players.map((p) => p.lastSeason));
  const keep = (p: Player) => {
    switch (s.format) {
      case 'mega': return p.lastSeason >= latest - 2;
      case 'mini': return p.lastSeason >= latest;
      case 'legends': return p.lastSeason < latest && p.matches >= 50;
      case 'alltime': return true;
      default: return p.matches >= s.poolMinMatches && (s.poolStatus === 'all' || (s.poolStatus === 'active') === p.active);
    }
  };
  const list = players.filter(keep); // players arrive sorted by IPL appearances (marquee order)
  if (s.nominationOrder === 'sets') list.sort((a, b) => b.basePrice - a.basePrice || ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.matches - a.matches);
  if (s.nominationOrder === 'random') for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
  return list.map((p) => p.id);
}

const C = (id: string, category: ChallengeDef['category'], text: string, effect: ChallengeDef['effect'], amount = 0, weight = 1): ChallengeDef =>
  ({ id, category, text, effect, amount, weight, enabled: true });

export const defaultChallenges = (): ChallengeDef[] => [
  C('b1', 'Budget', 'Increase your budget by ₹5 Cr', 'budget', 500),
  C('b2', 'Budget', 'Increase your budget by ₹10 Cr', 'budget', 1000, 0.5),
  C('b3', 'Budget', 'Decrease your budget by ₹5 Cr', 'budget', -500),
  C('b4', 'Budget', 'Decrease your budget by ₹10 Cr', 'budget', -1000, 0.5),
  C('b5', 'Budget', 'Pay a ₹2 Cr penalty', 'budget', -200),
  C('b6', 'Budget', 'One-time bonus of ₹3 Cr', 'budget', 300),
  C('p1', 'Player', 'Release your most expensive player', 'release_expensive', 0, 0.6),
  C('p2', 'Player', 'Release your highest-rated player (most IPL appearances)', 'release_top', 0, 0.6),
  C('p3', 'Player', 'Release one random player from your squad', 'release_random', 0, 0.8),
  C('p4', 'Player', 'You cannot bid on the next player', 'skip', 1),
  C('p5', 'Player', 'You must bid in the next round or pay a ₹1 Cr fine', 'must_bid', 100),
  C('p6', 'Player', 'Your next purchase must be an Indian player', 'next_indian'),
  C('p7', 'Player', 'Your next purchase must be an overseas player', 'next_overseas'),
  C('p8', 'Player', 'Your next purchase must cost below ₹5 Cr', 'next_max_price', 500),
  C('p9', 'Player', 'Nominate a player for the next auction round', 'nominate', 1),
  C('a1', 'Auction', 'Get one free nomination', 'nominate', 1),
  C('a2', 'Auction', 'Sit out the next two bidding rounds', 'skip', 2, 0.6),
  C('a3', 'Auction', 'Your next bid must be at least ₹1 Cr above the current bid', 'min_raise', 100),
  C('a4', 'Auction', 'Release one player before your next purchase', 'release_first', 0, 0.6),
  C('r1', 'Random', 'Swap a player with another team (both must agree)', 'swap', 0, 0.6),
  C('r2', 'Random', 'Get an additional ₹2 Cr', 'budget', 200),
  C('r3', 'Random', 'Lose ₹2 Cr', 'budget', -200),
  C('r4', 'Random', 'Pick an opponent to receive a ₹2 Cr penalty', 'target_budget', -200),
  C('r5', 'Random', 'Pick an opponent who cannot bid on the next player', 'target_skip', 1),
  C('r6', 'Random', 'Protect one of your players from release', 'protect'),
];
