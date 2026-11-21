// Client-side mirror of the server's bid rules, used only to explain to a user why a button is disabled.
// The server re-checks everything; nothing here is trusted.
import { fmt, maxBid, minNextBid, MIN_BASE, type Player, type RoomState, type TeamState } from '../../shared/types';

export function bidBlock(state: RoomState, t: TeamState, p: Player, amount: number, overseas: number): string | null {
  const lot = state.lot!, s = state.settings, r = t.r;
  if (state.paused) return 'Auction is paused';
  if (lot.rtm) return 'Bidding has closed';
  if (lot.bidder === t.id) return 'You hold the highest bid';
  if (r.skipRounds > 0) return 'Challenge: you sit this player out';
  if (r.releaseFirst) return 'Challenge: release a player first';
  if (r.nextBuy === 'indian' && p.overseas) return 'Challenge: Indian players only';
  if (r.nextBuy === 'overseas' && !p.overseas) return 'Challenge: overseas players only';
  if (t.squad.length >= s.maxSquad) return 'Squad is full';
  if (p.overseas && overseas >= s.maxOverseas) return 'Overseas limit reached';
  if (amount < minNextBid(lot, s, t)) return `Minimum bid is ${fmt(minNextBid(lot, s, t))}`;
  if (r.nextBuyMax != null && amount > r.nextBuyMax) return `Challenge: capped at ${fmt(r.nextBuyMax)}`;
  if (amount > maxBid(t, s)) return amount > t.purse ? 'Not enough purse' : `Max bid ${fmt(maxBid(t, s))} (${fmt(MIN_BASE)} reserved per empty slot)`;
  return null;
}

export function restrictionList(t: TeamState): string[] {
  const r = t.r, out: string[] = [];
  if (r.skipRounds) out.push(`Sits out ${r.skipRounds} round${r.skipRounds > 1 ? 's' : ''}`);
  if (r.mustBid) out.push(`Must bid next or pay ${fmt(r.mustBid)}`);
  if (r.nextBuy) out.push(`Next buy: ${r.nextBuy} only`);
  if (r.nextBuyMax != null) out.push(`Next buy ≤ ${fmt(r.nextBuyMax)}`);
  if (r.minRaise) out.push(`Next raise +${fmt(r.minRaise)}`);
  if (r.releaseFirst) out.push('Must release a player');
  if (r.nominations) out.push(`${r.nominations} nomination${r.nominations > 1 ? 's' : ''}`);
  return out;
}
