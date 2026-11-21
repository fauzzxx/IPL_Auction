import { AnimatePresence, motion } from 'framer-motion';
import { AlertOctagon, ChevronDown, Dices, FastForward, Flag as FlagIcon, Gavel, Heart, MessageCircle, Pause, Play, RotateCcw, Send, SkipForward, Sparkles, Star, Undo2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmt, franchise, maxBid, minNextBid, stat, teamName, type Player, type TeamState } from '../../../shared/types';
import { bidBlock, restrictionList } from '../rules';
import { useNow, useOpenPlayer, usePlayers, useRoom } from '../store';
import { Avatar, crToLakh, Flag, PurseBar, RoleChip, TeamBadge } from './ui';

export default function Auction({ goArena, goCatalogue }: { goArena: () => void; goCatalogue: () => void }) {
  const { state } = useRoom();
  const { map } = usePlayers();
  const shown = state.lot?.playerId ?? state.lastResult?.playerId ?? null;
  const p = shown ? map.get(shown) : undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      {state.phase === 'retention' ? <div className="lg:col-span-2 xl:col-span-2"><Retention /></div> : (
        <>
          <div className="order-2 lg:order-1">{p ? <PlayerPanel p={p} /> : <UpNext />}</div>
          <div className="order-1 space-y-4 lg:order-2">
            <BidCentre goCatalogue={goCatalogue} />
            <HostControls goArena={goArena} />
            <Feed />
          </div>
        </>
      )}
      <div className="order-3 lg:col-span-2 xl:col-span-1"><TeamRail /></div>
    </div>
  );
}

// ------------------------------------------------------------------ left: player on the block
export function PlayerPanel({ p }: { p: Player }) {
  const open = useOpenPlayer();
  const { me, act } = useRoom();
  const wished = me.wishlist.includes(p.id);
  const stats: [string, string | number][] = [['Matches', p.matches], ['Runs', p.stats.runs], ['Average', stat.avg(p).toFixed(1)], ['Strike rate', stat.sr(p).toFixed(1)], ['Wickets', p.stats.wickets], ['Economy', p.stats.ballsBowled ? stat.econ(p).toFixed(2) : '–']];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={p.id} initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} transition={{ duration: 0.3 }} className="card overflow-hidden">
        <div className="relative">
          <Avatar p={p} className="aspect-[4/3] w-full text-4xl lg:aspect-[4/5]" />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-900 via-ink-900/80 to-transparent p-4 pt-12">
            <div className="flex flex-wrap items-center gap-1.5"><RoleChip role={p.role} />{p.overseas && <span className="chip bg-amber-500/20 text-amber-300">Overseas</span>}{!p.active && <span className="chip bg-slate-500/20 text-slate-300">Former</span>}</div>
            <h2 className="display mt-1 text-3xl leading-none text-white">{p.name}</h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-300"><Flag country={p.nationality} />{p.nationality}</div>
          </div>
          <button aria-label={wished ? 'Remove from wishlist' : 'Add to wishlist'} aria-pressed={wished} onClick={() => act('wishlist.toggle', { playerId: p.id })} className="absolute right-3 top-3 rounded-full bg-black/50 p-2 backdrop-blur hover:bg-black/70"><Heart size={18} className={wished ? 'fill-rose-500 text-rose-500' : 'text-white'} /></button>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-3 gap-2">
            {stats.map(([k, v]) => <div key={k} className="rounded-lg bg-ink-700/70 px-2 py-1.5 text-center"><div className="font-display text-xl font-bold leading-none text-white">{v}</div><div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">{k}</div></div>)}
          </div>
          <dl className="space-y-1 text-sm">
            {p.battingStyle && <Row k="Batting">{p.battingStyle}{p.battingPosition ? ` · ${p.battingPosition}` : ''}</Row>}
            {p.bowlingStyle && <Row k="Bowling">{p.bowlingStyle}</Row>}
            <Row k="IPL seasons">{p.seasons[0]}–{p.seasons[p.seasons.length - 1]} ({p.seasons.length})</Row>
          </dl>
          <div className="flex flex-wrap gap-1.5">{p.teams.map((t) => franchise(t) ? <TeamBadge key={t} id={t} size={28} /> : <span key={t} title={teamName(t)} className="chip h-7 bg-ink-600 text-slate-300">{t}</span>)}</div>
          <button onClick={() => open(p.id)} className="text-xs font-semibold text-gold hover:underline">Full profile →</button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right text-slate-200">{children}</dd></div>;

function UpNext() {
  const { state, pool } = useRoom();
  const { map } = usePlayers();
  const open = useOpenPlayer();
  const next = pool.filter((id) => !state.status[id]).slice(0, 6).map((id) => map.get(id)!).filter(Boolean);
  return (
    <div className="card p-4">
      <h3 className="h-section !text-base">Up next</h3>
      {state.settings.nominationOrder === 'random' && <p className="text-xs text-slate-500">Order is random — this is just a sample of who is left.</p>}
      <ul className="mt-2 space-y-1.5">
        {next.map((p) => (
          <li key={p.id}><button onClick={() => open(p.id)} className="flex w-full items-center gap-2.5 rounded-lg bg-ink-700/60 p-1.5 text-left hover:bg-ink-600">
            <Avatar p={p} className="h-10 w-10 shrink-0 rounded-lg text-[7px]" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{p.name}</span><span className="text-xs text-slate-400">{p.role} · {p.nationality}</span></span>
            <span className="font-display text-sm font-bold text-gold">{fmt(state.baseOverrides[p.id] ?? p.basePrice)}</span></button></li>
        ))}
        {!next.length && <li className="text-sm text-slate-400">No upcoming players left.</li>}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ centre: bidding
function BidCentre({ goCatalogue }: { goCatalogue: () => void }) {
  const { state, myTeam, act, me, pool, isHost } = useRoom();
  const { map } = usePlayers();
  const now = useNow(200);
  const [custom, setCustom] = useState('');
  const lot = state.lot, s = state.settings;
  const p = lot ? map.get(lot.playerId) : undefined;
  const res = state.lastResult;
  const overseas = myTeam ? myTeam.squad.filter((e) => map.get(e.playerId)?.overseas).length : 0;
  const nextUp = !lot ? map.get(pool.find((id) => !state.status[id]) ?? '') : undefined;

  if (!lot || !p) {
    const rp = res ? map.get(res.playerId) : undefined;
    return (
      <div className="card relative flex min-h-[300px] flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center">
        {res && rp ? (
          <>
            <div className={`stamp display rounded-xl border-4 px-6 py-1 text-6xl ${res.outcome === 'sold' ? 'border-emerald-400 text-emerald-400' : 'border-red-400 text-red-400'}`}>{res.outcome === 'sold' ? 'Sold!' : 'Unsold'}</div>
            <div className="display text-2xl text-white">{rp.name}</div>
            {res.outcome === 'sold' && res.teamId && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="flex items-center gap-3">
                <TeamBadge id={res.teamId} size={44} /><div className="text-left"><div className="text-sm text-slate-300">{teamName(res.teamId)}{res.via === 'rtm' ? ' · Right to Match' : ''}</div><div className="font-display text-3xl font-bold text-gold">{fmt(res.price!)}</div></div>
              </motion.div>
            )}
          </>
        ) : (
          <><Gavel size={40} className="text-gold" /><div className="display text-2xl text-white">{state.paused ? 'Auction paused' : 'Waiting for the next player'}</div></>
        )}
        <p className="text-sm text-slate-400">{state.paused ? 'The host has paused the auction.' : s.autoNext && s.nominationOrder !== 'manual' && !state.challengeDue && !state.run ? 'Next player arrives in a few seconds…' : 'The host will bring the next player.'}</p>
        {nextUp && me.wishlist.includes(nextUp.id) && <div className="chip bg-rose-500/15 !py-1 text-rose-300"><Heart size={12} className="fill-current" /> Wishlist alert: {nextUp.name} is up next</div>}
        {myTeam && myTeam.r.nominations > 0 && <button className="btn-gold" onClick={goCatalogue}><Star size={16} />You have a nomination — pick a player</button>}
        {myTeam?.r.releaseFirst && <div className="chip bg-red-500/15 !py-1 text-red-300">Challenge: release a player from the Teams tab before you can bid</div>}
      </div>
    );
  }

  const remaining = state.paused ? lot.remainingMs : lot.rtm ? lot.rtm.endsAt - now : lot.endsAt != null ? lot.endsAt - now : null;
  const secs = remaining == null ? null : Math.max(0, Math.ceil(remaining / 1000));
  const total = lot.rtm ? s.rtmWindowSec : s.timerSec;
  const frac = remaining == null || !total ? 1 : Math.max(0, Math.min(1, remaining / (total * 1000)));
  const urgent = secs != null && secs <= 5 && !state.paused;
  const baseline = lot.bidder ? lot.bid : lot.basePrice;
  const min = minNextBid(lot, s, myTeam ?? undefined);
  const options = lot.bidder ? s.increments.map((inc) => ({ label: `+ ${fmt(inc)}`, amount: baseline + inc + (myTeam?.r.minRaise ?? 0) })) : [{ label: 'Open at base', amount: lot.basePrice }, ...s.increments.slice(0, 4).map((inc) => ({ label: `Base + ${fmt(inc)}`, amount: lot.basePrice + inc }))];
  const why = (amt: number) => (myTeam ? bidBlock(state, myTeam, p, amt, overseas) : 'Pick a franchise to bid');
  const generalBlock = why(Math.max(min, 0));
  const place = (amount: number) => act('bid', { amount });
  const wished = me.wishlist.includes(p.id);
  const canRtm = lot.rtm && myTeam && lot.rtm.eligible.includes(myTeam.id);

  return (
    <div className={`card relative overflow-hidden p-4 sm:p-5 ${urgent ? '!border-red-500/60' : ''}`}>
      <div className="absolute inset-x-0 top-0 h-1 bg-ink-600"><div className={`h-full transition-[width] duration-200 ease-linear ${urgent ? 'bg-red-500' : 'bg-gradient-to-r from-gold to-orange-400'}`} style={{ width: `${frac * 100}%` }} /></div>
      {wished && <div className="chip mb-2 bg-rose-500/15 text-rose-300"><Heart size={11} className="fill-current" /> On your wishlist</div>}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[.2em] text-slate-400">Lot {lot.no} · {lot.bidder ? 'Current bid' : 'Base price'}</div>
          <AnimatePresence mode="popLayout">
            <motion.div key={baseline} initial={{ y: 24, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -24, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 24 }}
              className={`font-display text-6xl font-extrabold leading-none sm:text-7xl ${lot.bidder ? 'text-emerald-400' : 'text-white'}`}>{fmt(baseline)}</motion.div>
          </AnimatePresence>
          <div className="mt-2 flex h-9 items-center gap-2">
            {lot.bidder ? (
              <motion.div key={lot.bidder + lot.bid} initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="flex items-center gap-2"><TeamBadge id={lot.bidder} size={34} ring /><span className="text-sm font-semibold text-white">{teamName(lot.bidder)}</span><span className="text-xs text-slate-400">leads · {lot.bids.length} bid{lot.bids.length > 1 ? 's' : ''}</span></motion.div>
            ) : <span className="text-sm text-slate-400">No bids yet — who opens?{lot.nominatedBy ? ` Nominated by ${lot.nominatedBy}.` : ''}</span>}
          </div>
        </div>
        <div className="shrink-0 text-center">
          <div className={`relative flex h-24 w-24 items-center justify-center rounded-full ${urgent ? 'pulse-ring' : ''}`}>
            <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90"><circle cx="50" cy="50" r="44" fill="none" stroke="#1b2646" strokeWidth="8" /><circle cx="50" cy="50" r="44" fill="none" stroke={urgent ? '#ef4444' : '#f5b942'} strokeWidth="8" strokeLinecap="round" strokeDasharray={276.5} strokeDashoffset={276.5 * (1 - frac)} style={{ transition: 'stroke-dashoffset .2s linear' }} /></svg>
            <span className={`font-display text-4xl font-extrabold ${urgent ? 'text-red-400' : 'text-white'}`}>{state.paused ? <Pause size={28} /> : secs ?? '∞'}</span>
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">{state.paused ? 'Paused' : lot.rtm ? 'RTM window' : secs == null ? 'Host closes' : 'Seconds'}</div>
        </div>
      </div>

      {lot.rtm ? (
        <div className="mt-4 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3 text-sm">
          <div className="font-semibold text-violet-200">Right to Match — {lot.rtm.eligible.map(teamName).join(', ')} may match {fmt(lot.rtm.price)}</div>
          <div className="mt-2 flex gap-2">{canRtm && <button className="btn-gold" onClick={() => act('rtm.use')}>Use RTM card for {fmt(lot.rtm.price)}</button>}{isHost && <button className="btn-ghost" onClick={() => act('rtm.decline')}>Close window — sell to {lot.bidder}</button>}</div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {options.map((o, i) => {
              const blocked = why(o.amount);
              return (
                <button key={o.label} disabled={!!blocked} title={blocked ?? `Bid ${fmt(o.amount)}`} onClick={() => place(o.amount)} className={`${i === 0 ? 'btn-gold col-span-2 sm:col-span-1' : 'btn-ghost'} flex-col !gap-0 !py-2`}>
                  <span className="text-[11px] font-medium opacity-75">{o.label}</span><span className="font-display text-lg font-bold leading-tight">{fmt(o.amount)}</span>
                </button>
              );
            })}
          </div>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = crToLakh(custom); if (v > 0) place(v).then((ok) => ok && setCustom('')); }}>
            <input type="number" inputMode="decimal" step="0.05" min="0" placeholder={`Custom bid in ₹ crore (min ${min / 100})`} value={custom} onChange={(e) => setCustom(e.target.value)} disabled={!myTeam} aria-label="Custom bid amount in crore" />
            <button className="btn-ghost shrink-0" disabled={!myTeam || !custom}>Place bid</button>
          </form>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
            {myTeam ? (<>
              <span>Max bid <b className="text-white">{fmt(maxBid(myTeam, s))}</b></span><span>Squad <b className="text-white">{myTeam.squad.length}/{s.maxSquad}</b></span><span>Overseas <b className="text-white">{overseas}/{s.maxOverseas}</b></span>
              {generalBlock && <span className="font-semibold text-amber-300">{generalBlock}</span>}
              {restrictionList(myTeam).map((r) => <span key={r} className="chip bg-violet-500/15 text-violet-300">{r}</span>)}
            </>) : <span>You are spectating. Pick a free franchise in the Teams panel to bid.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ host controls
function HostControls({ goArena }: { goArena: () => void }) {
  const { state, isHost, act } = useRoom();
  if (!isHost) return state.challengeDue ? <button onClick={goArena} className="card flex w-full items-center gap-2 !border-gold/50 p-3 text-sm text-gold"><Sparkles size={16} />A challenge is coming — watch the Challenge Arena</button> : null;
  const lot = state.lot;
  const unsold = Object.values(state.status).filter((x) => x === 'unsold').length;
  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-[.2em] text-gold">Host controls</span>{state.paused && <span className="chip bg-amber-500/20 text-amber-300">Paused</span>}</div>
      <div className="flex flex-wrap gap-2">
        {!lot && <>
          <button className="btn-gold" disabled={state.paused} onClick={() => act('next')}><FastForward size={16} />Next player</button>
          <button className="btn-ghost" disabled={state.paused} onClick={() => act('next', { random: true })}><Dices size={16} />Random player</button>
        </>}
        {lot && !lot.rtm && <>
          <button className="btn-green" disabled={!lot.bidder} onClick={() => act('sold')}><Gavel size={16} />Sold</button>
          <button className="btn-danger" onClick={() => act('unsold')}><XCircle size={16} />Unsold</button>
          <button className="btn-ghost" onClick={() => act('skip')}><SkipForward size={16} />Skip</button>
        </>}
        {state.paused ? <button className="btn-green" onClick={() => act('resume')}><Play size={16} />Resume</button> : <button className="btn-ghost" onClick={() => act('pause')}><Pause size={16} />Pause</button>}
        {!lot && <button className="btn-ghost" disabled={!state.sales.length} onClick={() => confirm('Undo the last sale? The purse and squad will be fully restored.') && act('undo')}><Undo2 size={16} />Undo last sale</button>}
        {!lot && unsold > 0 && state.settings.reauctionUnsold && <button className="btn-ghost" onClick={() => act('reauction')}><RotateCcw size={16} />Re-auction {unsold} unsold</button>}
        {state.settings.challengesEnabled && !lot && <button className={`btn-ghost ${state.challengeDue ? '!border-gold !text-gold pulse-ring' : ''}`} onClick={goArena}><Sparkles size={16} />{state.challengeDue ? 'Challenge time!' : 'Challenge Arena'}</button>}
        <span className="flex-1" />
        <button className="btn-danger" onClick={() => confirm('Emergency stop: freeze the auction and void the current lot?') && act('emergency')}><AlertOctagon size={16} />Emergency stop</button>
        {!lot && <button className="btn-danger" onClick={() => confirm('End the auction for everyone and show the final results?') && act('end')}><FlagIcon size={16} />End auction</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ activity feed + chat
const KIND_COLOR: Record<string, string> = { sold: 'text-emerald-300', unsold: 'text-red-300', challenge: 'text-violet-300', release: 'text-amber-300', phase: 'text-gold', lot: 'text-sky-300', undo: 'text-amber-300', rtm: 'text-violet-300' };
function Feed() {
  const { state, act } = useRoom();
  const [text, setText] = useState('');
  const items = useMemo(() => state.log.slice(-80).reverse(), [state.log]);
  return (
    <div className="card flex flex-col">
      <div className="flex items-center gap-2 border-b border-ink-600 px-4 py-2.5"><MessageCircle size={15} className="text-gold" /><span className="text-[11px] font-semibold uppercase tracking-[.2em] text-slate-300">Live activity</span></div>
      <ul className="max-h-72 space-y-1 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((e) => (
            <motion.li key={e.id} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-2">
              {e.teamId ? <TeamBadge id={e.teamId} size={20} /> : <span className="mt-1.5 h-1.5 w-5 shrink-0 rounded-full bg-ink-500" />}
              <span className={e.kind === 'chat' ? 'text-slate-200' : KIND_COLOR[e.kind] ?? 'text-slate-400'}>{e.kind === 'chat' && <b className="text-white">{e.by}: </b>}{e.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <form className="flex gap-2 border-t border-ink-600 p-2.5" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { act('chat', { text }); setText(''); } }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Say something to the room…" aria-label="Chat message" />
        <button className="btn-ghost !px-3" aria-label="Send"><Send size={16} /></button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ right: all teams
export function TeamRail() {
  const { state, session, act } = useRoom();
  const { map } = usePlayers();
  const open = useOpenPlayer();
  const [expanded, setExpanded] = useState<string | null>(null);
  const me = state.participants.find((p) => p.id === session.participantId);
  const teams = Object.values(state.teams);
  const s = state.settings;
  const free = state.phase !== 'ended' && !me?.teamId && teams.length < s.maxTeams;
  const prev = useRef<Record<string, number>>({});
  useEffect(() => { prev.current = Object.fromEntries(teams.map((t) => [t.id, t.purse])); });

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between px-1"><span className="text-[11px] font-semibold uppercase tracking-[.2em] text-slate-300">Teams · {teams.length}</span><span className="text-[11px] text-slate-500">purse remaining</span></div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {teams.map((t: TeamState) => {
          const owner = state.participants.find((p) => p.id === t.ownerId);
          const os = t.squad.filter((e) => map.get(e.playerId)?.overseas).length;
          const leading = state.lot?.bidder === t.id;
          const rs = restrictionList(t);
          return (
            <li key={t.id} className={`rounded-xl border bg-ink-700/50 transition ${leading ? 'border-emerald-400/70 shadow-[0_0_24px_-6px_rgba(52,211,153,.6)]' : 'border-ink-600'}`}>
              <button className="flex w-full items-center gap-2.5 p-2.5 text-left" onClick={() => setExpanded(expanded === t.id ? null : t.id)} aria-expanded={expanded === t.id}>
                <TeamBadge id={t.id} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-semibold text-white">{franchise(t.id)?.city}</span>
                    <motion.span key={t.purse} initial={{ scale: 1.25, color: '#f5b942' }} animate={{ scale: 1, color: '#ffffff' }} className="font-display text-lg font-bold">{fmt(t.purse)}</motion.span></div>
                  <PurseBar team={t} compact />
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                    <span className={`h-1.5 w-1.5 rounded-full ${owner?.connected ? 'bg-emerald-400' : 'bg-slate-600'}`} /><span className="truncate">{owner?.name ?? 'No owner'}{t.ownerId === me?.id ? ' (you)' : ''}</span>
                    <span className="ml-auto shrink-0">{t.squad.length}/{s.maxSquad} · OS {os}/{s.maxOverseas}{s.rtmEnabled ? ` · RTM ${t.rtmLeft}` : ''}</span><ChevronDown size={13} className={`transition ${expanded === t.id ? 'rotate-180' : ''}`} />
                  </div>
                  {rs.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{rs.map((r) => <span key={r} className="chip bg-violet-500/15 !text-[10px] text-violet-300">{r}</span>)}</div>}
                </div>
              </button>
              {expanded === t.id && (
                <ul className="space-y-0.5 border-t border-ink-600 p-2 text-xs">
                  {t.squad.map((e) => { const p = map.get(e.playerId); return p && <li key={e.playerId}><button onClick={() => open(p.id)} className="flex w-full justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-ink-600"><span className="truncate text-slate-200">{p.name} <span className="text-slate-500">{p.role}{p.overseas ? ' · OS' : ''}</span></span><span className="shrink-0 font-semibold text-gold">{fmt(e.price)}</span></button></li>; })}
                  {!t.squad.length && <li className="px-1.5 py-1 text-slate-500">No players yet</li>}
                  {!t.ownerId && !me?.teamId && state.phase !== 'ended' && <li><button className="btn-ghost mt-1 w-full !py-1 !text-xs" onClick={() => act('team.select', { teamId: t.id })}>Take over this franchise</button></li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {free && <FreeTeams />}
    </div>
  );
}

function FreeTeams() {
  const { state, act } = useRoom();
  const [open, setOpen] = useState(false);
  const ids = ['CSK', 'MI', 'RCB', 'KKR', 'RR', 'SRH', 'DC', 'PBKS', 'GT', 'LSG'].filter((id) => !state.teams[id]);
  return (
    <div className="mt-3 rounded-xl border border-dashed border-ink-500 p-2.5 text-center">
      <button className="text-sm font-semibold text-gold" onClick={() => setOpen(!open)}>You are spectating — pick a free franchise</button>
      {open && <div className="mt-2 flex flex-wrap justify-center gap-2">{ids.map((id) => <button key={id} onClick={() => act('team.select', { teamId: id })} aria-label={`Join as ${teamName(id)}`}><TeamBadge id={id} size={38} /></button>)}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ retention window
function Retention() {
  const { state, myTeam, act, isHost, pool } = useRoom();
  const { map } = usePlayers();
  const s = state.settings;
  const kept = myTeam?.squad.filter((e) => e.via === 'retention') ?? [];
  const nextCost = s.retentionCosts[Math.min(kept.length, s.retentionCosts.length - 1)];
  const eligible = useMemo(() => (myTeam ? pool.map((id) => map.get(id)!).filter((p) => p && p.teams.includes(myTeam.id) && !state.status[p.id]) : []), [pool, map, myTeam, state.status]);
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="h-section">Retention window</h2><p className="text-sm text-slate-400">Keep up to {s.maxRetentions} players who have played for your franchise. Costs: {s.retentionCosts.map(fmt).join(' · ')}</p></div>
        {isHost && <button className="btn-gold" onClick={() => act('beginBidding')}><Play size={16} />Lock retentions & start bidding</button>}
      </div>
      {!myTeam ? <p className="mt-4 text-sm text-slate-400">You are spectating.</p> : (
        <>
          <h3 className="mt-4 text-sm font-semibold text-white">Your retentions ({kept.length}/{s.maxRetentions})</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {kept.map((e) => <button key={e.playerId} title="Cancel retention" onClick={() => act('unretain', { playerId: e.playerId })} className="chip bg-gold/15 !py-1 !text-xs text-gold">{map.get(e.playerId)?.name} · {fmt(e.price)} ✕</button>)}
            {!kept.length && <span className="text-sm text-slate-500">None yet</span>}
          </div>
          <h3 className="mt-4 text-sm font-semibold text-white">Eligible players{kept.length < s.maxRetentions ? ` — next retention costs ${fmt(nextCost)}` : ''}</h3>
          <div className="mt-2 grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {eligible.map((p) => (
              <button key={p.id} disabled={kept.length >= s.maxRetentions || nextCost > myTeam.purse} onClick={() => act('retain', { playerId: p.id })} className="flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-700/60 p-2 text-left hover:border-gold/60 disabled:opacity-40">
                <Avatar p={p} className="h-11 w-11 shrink-0 rounded-lg text-[7px]" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{p.name}</span><span className="text-xs text-slate-400">{p.role} · {p.matches} matches{p.overseas ? ' · OS' : ''}</span></span>
              </button>
            ))}
            {!eligible.length && <p className="text-sm text-slate-500">No eligible players in this auction pool.</p>}
          </div>
        </>
      )}
    </div>
  );
}
