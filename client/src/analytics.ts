// Derived numbers for dashboards, stats and awards. Everything is computed from the live auction state
// plus real IPL career records — no invented ratings.
import { fmt, teamName, type Player, type RoomState, type Sale, type Settings, type TeamState } from '../../shared/types';

export interface TeamSummary {
  team: TeamState; spent: number; count: number; indian: number; overseas: number;
  roles: Record<'BAT' | 'WK' | 'AR' | 'BOWL', number>;
  batting: number; bowling: number; experience: number; warnings: string[];
}

const top = (xs: number[], n: number) => xs.sort((a, b) => b - a).slice(0, n).reduce((a, b) => a + b, 0);

export function summarize(team: TeamState, map: Map<string, Player>, s: Settings): TeamSummary {
  const ps = team.squad.map((e) => map.get(e.playerId)).filter(Boolean) as Player[];
  const roles = { BAT: 0, WK: 0, AR: 0, BOWL: 0 };
  ps.forEach((p) => roles[p.role]++);
  const overseas = ps.filter((p) => p.overseas).length;
  const warnings: string[] = [];
  const need = s.minSquad - ps.length;
  if (roles.WK === 0) warnings.push('Your team needs at least one wicketkeeper.');
  if (roles.BOWL + roles.AR < 5) warnings.push(`Only ${roles.BOWL + roles.AR} bowling options — an XI needs at least five.`);
  if (roles.BAT + roles.WK + roles.AR < 6) warnings.push('Batting is thin — fewer than six players who bat.');
  if (need > 0) warnings.push(`${need} more player${need > 1 ? 's' : ''} needed to reach the minimum squad of ${s.minSquad}.`);
  if (overseas >= s.maxOverseas) warnings.push('Your team has reached its overseas player limit.');
  if (ps.length >= s.maxSquad) warnings.push('Squad is full.');
  if (need > 0 && team.purse < need * 30) warnings.push('Remaining purse cannot cover the mandatory squad slots.');
  return {
    team, spent: team.squad.reduce((a, e) => a + e.price, 0), count: ps.length, indian: ps.length - overseas, overseas, roles,
    batting: top(ps.map((p) => p.stats.runs), 7), bowling: top(ps.map((p) => p.stats.wickets), 5),
    experience: ps.reduce((a, p) => a + p.matches, 0), warnings,
  };
}

export interface Award { title: string; winner: string; teamId?: string; detail: string; method: string }

export function awards(state: RoomState, map: Map<string, Player>): Award[] {
  const sums = Object.values(state.teams).map((t) => summarize(t, map, state.settings)).filter((x) => x.count > 0);
  const sales = state.sales.filter((x) => map.has(x.playerId));
  const out: Award[] = [];
  if (!sums.length) return out;
  const best = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));
  if (sales.length) {
    const exp = best(sales, (x) => x.price);
    out.push({ title: 'Most Expensive Signing', winner: map.get(exp.playerId)!.name, teamId: exp.teamId, detail: `${fmt(exp.price)} · ${teamName(exp.teamId)}`, method: 'Highest winning bid of the auction' });
    const val = best(sales, (x) => map.get(x.playerId)!.matches / Math.max(10, x.price));
    out.push({ title: 'Best Value Purchase', winner: map.get(val.playerId)!.name, teamId: val.teamId, detail: `${map.get(val.playerId)!.matches} IPL matches for ${fmt(val.price)}`, method: 'Most IPL appearances bought per rupee' });
  }
  const strat = best(sums, (x) => x.experience / Math.max(100, x.spent));
  out.push({ title: 'Best Auction Strategy', winner: teamName(strat.team.id), teamId: strat.team.id, detail: `${strat.experience} matches of IPL experience for ${fmt(strat.spent)}`, method: 'Most combined IPL experience per crore spent' });
  const bat = best(sums, (x) => x.batting);
  out.push({ title: 'Strongest Batting Lineup', winner: teamName(bat.team.id), teamId: bat.team.id, detail: `${bat.batting.toLocaleString()} IPL runs in the top seven`, method: 'Career IPL runs of the seven highest run-scorers in the squad' });
  const bowl = best(sums, (x) => x.bowling);
  out.push({ title: 'Strongest Bowling Attack', winner: teamName(bowl.team.id), teamId: bowl.team.id, detail: `${bowl.bowling} IPL wickets in the top five`, method: 'Career IPL wickets of the five leading wicket-takers in the squad' });
  const mb = Math.max(1, ...sums.map((x) => x.batting)), mw = Math.max(1, ...sums.map((x) => x.bowling)), me = Math.max(1, ...sums.map((x) => x.experience));
  const overall = best(sums, (x) => x.batting / mb + x.bowling / mw + x.experience / me - (x.roles.WK ? 0 : 0.5));
  out.push({ title: 'Best Overall Squad', winner: teamName(overall.team.id), teamId: overall.team.id, detail: `${overall.count} player${overall.count === 1 ? '' : 's'} · ${overall.roles.BAT} BAT · ${overall.roles.WK} WK · ${overall.roles.AR} AR · ${overall.roles.BOWL} BOWL`, method: 'Batting, bowling and experience scores combined; penalty for no wicketkeeper' });
  return out;
}

export function download(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cr = (l: number) => (l / 100).toFixed(2);

export function reportCsv(state: RoomState, map: Map<string, Player>): string {
  const rows: unknown[][] = [[`IPL Auction Arena — ${state.name} (${state.code})`], [],
    ['TEAM SUMMARY'], ['Team', 'Owner', 'Starting purse (Cr)', 'Spent (Cr)', 'Remaining (Cr)', 'Players', 'Overseas', 'BAT', 'WK', 'AR', 'BOWL']];
  for (const t of Object.values(state.teams)) {
    const x = summarize(t, map, state.settings);
    rows.push([teamName(t.id), state.participants.find((p) => p.id === t.ownerId)?.name ?? '', cr(t.initialPurse), cr(x.spent), cr(t.purse), x.count, x.overseas, x.roles.BAT, x.roles.WK, x.roles.AR, x.roles.BOWL]);
  }
  rows.push([], ['SQUADS'], ['Team', 'Player', 'Role', 'Nationality', 'Overseas', 'Price (Cr)', 'Acquired via']);
  for (const t of Object.values(state.teams)) for (const e of t.squad) { const p = map.get(e.playerId); if (p) rows.push([teamName(t.id), p.name, p.role, p.nationality, p.overseas ? 'Yes' : 'No', cr(e.price), e.via]); }
  rows.push([], ['SALES IN ORDER'], ['Lot', 'Player', 'Sold to', 'Price (Cr)', 'Via', 'Bids', 'Time']);
  state.sales.forEach((x: Sale) => rows.push([x.lotNo, map.get(x.playerId)?.name, teamName(x.teamId), cr(x.price), x.via, x.bids.length, new Date(x.t).toLocaleString()]));
  rows.push([], ['UNSOLD'], ...Object.entries(state.status).filter(([, v]) => v === 'unsold').map(([id]) => [map.get(id)?.name]));
  rows.push([], ['CHALLENGES'], ['Time', 'Team', 'Challenge', 'Status', 'Result', 'Budget change (Cr)']);
  state.challengeLog.forEach((h) => rows.push([new Date(h.t).toLocaleString(), teamName(h.teamId), h.text, h.status, h.result, cr(h.budgetDelta)]));
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
