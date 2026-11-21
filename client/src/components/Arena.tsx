import { AnimatePresence, motion } from 'framer-motion';
import { Check, Info, Pencil, Plus, Sparkles, Trash2, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { fmt, franchise, spinTurnTeam, teamName, type ChallengeDef, type EffectType, type WheelSpin } from '../../../shared/types';
import { usePlayers, useRoom } from '../store';
import { Empty, Field, Modal, TeamBadge } from './ui';

const SPIN_MS = 4600;
const CAT_COLOR: Record<string, string> = { Budget: '#f5b942', Player: '#38bdf8', Auction: '#a78bfa', Random: '#34d399', Custom: '#fb7185' };
const EFFECTS: [EffectType, string, string][] = [
  ['budget', 'Change own budget', 'Amount in ₹ lakh (negative = penalty)'], ['target_budget', 'Change an opponent\'s budget', 'Amount in ₹ lakh (negative = penalty)'],
  ['release_expensive', 'Release most expensive player', ''], ['release_top', 'Release most experienced player', ''], ['release_random', 'Release a random player', ''],
  ['skip', 'Sit out bidding rounds', 'Number of rounds'], ['target_skip', 'An opponent sits out the next round', ''], ['must_bid', 'Must bid on next player', 'Fine in ₹ lakh if they do not'],
  ['next_indian', 'Next purchase must be Indian', ''], ['next_overseas', 'Next purchase must be overseas', ''], ['next_max_price', 'Cap on next purchase price', 'Cap in ₹ lakh'],
  ['min_raise', 'Next bid must raise by extra', 'Extra raise in ₹ lakh'], ['release_first', 'Release a player before next purchase', ''], ['nominate', 'Earn a nomination', 'Number of nominations'],
  ['swap', 'Swap a player with another team', ''], ['protect', 'Protect a player from release', ''], ['none', 'Honour challenge (no automatic effect)', 'Optional budget change in ₹ lakh'],
];

interface Slice { key: string; label: string; color: string; text?: string }

/** One wheel. The server decides the winner; `spin.nonce` changing is the cue for every browser to animate to the same slice. */
function Wheel({ slices, spin, onSettled }: { slices: Slice[]; spin: WheelSpin | null; onSettled: (nonce: number) => void }) {
  const [rot, setRot] = useState(0);
  const [animate, setAnimate] = useState(false);
  const seen = useRef<number | null>(spin?.nonce ?? null);
  const n = Math.max(1, slices.length), a = 360 / n;

  useEffect(() => {
    if (!spin) return;
    const target = 360 - (spin.index + 0.5) * a;
    if (seen.current === spin.nonce) { setAnimate(false); setRot(target); return; } // already decided before we arrived: no replay
    seen.current = spin.nonce;
    setAnimate(true);
    setRot((r) => Math.ceil(r / 360) * 360 + 360 * 6 + target);
    const t = setTimeout(() => onSettled(spin.nonce), SPIN_MS);
    return () => clearTimeout(t);
  }, [spin?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const pt = (deg: number, r: number) => { const rad = ((deg - 90) * Math.PI) / 180; return [150 + r * Math.cos(rad), 150 + r * Math.sin(rad)]; };
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1" aria-hidden><div className="h-0 w-0 border-x-[13px] border-t-[24px] border-x-transparent border-t-gold drop-shadow-[0_2px_6px_rgba(0,0,0,.8)]" /></div>
      <svg viewBox="0 0 300 300" className="h-full w-full drop-shadow-[0_0_40px_rgba(245,185,66,.25)]" role="img" aria-label="Spinning wheel">
        <circle cx="150" cy="150" r="148" fill="#0d1428" stroke="#f5b942" strokeWidth="3" />
        <g style={{ transformOrigin: '150px 150px', transform: `rotate(${rot}deg)`, transition: animate ? `transform ${SPIN_MS}ms cubic-bezier(.12,.62,.08,1)` : 'none' }}>
          {slices.map((s, i) => {
            const [x1, y1] = pt(i * a, 140), [x2, y2] = pt((i + 1) * a, 140);
            const mid = (i + 0.5) * a;
            return (
              <g key={s.key}>
                <path d={n === 1 ? 'M150 10 A140 140 0 1 1 149.9 10 Z' : `M150 150 L${x1} ${y1} A140 140 0 ${a > 180 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={s.color} stroke="#050814" strokeWidth="1.5" opacity={i % 2 ? 0.82 : 1} />
                <text transform={`rotate(${mid - 90} 150 150)`} x={n > 12 ? 284 : 270} y="150" textAnchor="end" dominantBaseline="middle" fontSize={n > 16 ? 7.5 : n > 10 ? 9.5 : 15} fontWeight="700" fill={s.text ?? '#0b1020'} fontFamily="Barlow Condensed, sans-serif">{s.label}</text>
              </g>
            );
          })}
        </g>
        <circle cx="150" cy="150" r="22" fill="#0d1428" stroke="#f5b942" strokeWidth="3" /><circle cx="150" cy="150" r="7" fill="#f5b942" />
      </svg>
    </div>
  );
}

export default function Arena() {
  const { state, act, isHost, myTeam, session } = useRoom();
  const { map } = usePlayers();
  const [teamDone, setTeamDone] = useState<number | null>(state.teamWheel?.nonce ?? null);
  const [chDone, setChDone] = useState<number | null>(state.challengeWheel?.nonce ?? null);
  const [assignTeam, setAssignTeam] = useState('');
  const [assignCh, setAssignCh] = useState('');
  const [editing, setEditing] = useState<Partial<ChallengeDef> | null>(null);
  const [mineP, setMineP] = useState('');
  const [target, setTarget] = useState('');
  const [theirs, setTheirs] = useState('');

  const s = state.settings, run = state.run;
  const teams = Object.values(state.teams);
  const teamSpinning = !!state.teamWheel && teamDone !== state.teamWheel.nonce;
  const chSpinning = !!state.challengeWheel && chDone !== state.challengeWheel.nonce;
  const spinning = teamSpinning || chSpinning;
  const live = state.phase === 'auction';
  const challenge = (id: string | null | undefined) => state.challenges.find((c) => c.id === id);

  const teamSlices: Slice[] = (state.teamWheel?.options ?? teams.map((t) => t.id)).map((id) => ({ key: id, label: id, color: franchise(id)?.color ?? '#27345c', text: franchise(id)?.text }));
  const pool = state.challenges.filter((c) => c.enabled && (s.challengeRepeat || !state.usedChallenges.includes(c.id)));
  const chIds = state.challengeWheel?.options ?? pool.map((c) => c.id);
  const chSlices: Slice[] = chIds.map((id) => { const c = challenge(id); return { key: id, label: (c?.text ?? 'Removed').slice(0, chIds.length > 16 ? 26 : 30), color: CAT_COLOR[c?.category ?? 'Custom'] }; });

  const pickedTeam = !teamSpinning && state.teamWheel ? state.teamWheel.options[state.teamWheel.index] : null;
  const pickedCh = !chSpinning && state.challengeWheel ? challenge(state.challengeWheel.options[state.challengeWheel.index]) : null;
  const history = [...state.challengeLog].reverse().filter((h) => !(chSpinning && state.challengeWheel && h.t >= state.challengeWheel.nonce - 5));
  // Who may press the spin buttons: always the host; in rotation mode also the team whose turn it is (once a challenge is due).
  const turnTeam = spinTurnTeam(state);
  const myTurn = s.spinBy === 'rotation' && !!myTeam && myTeam.id === turnTeam && state.challengeDue;
  const spinner = isHost || myTurn;
  const queued = !!state.lot && state.challengeDue;
  const canSpinTeam = spinner && live && !spinning && !queued && (!run || (run.stage === 'team' && isHost));
  const canSpinCh = spinner && live && !state.lot && !spinning && run?.stage === 'team';
  const showButtons = isHost || s.spinBy === 'rotation';
  const left = Math.max(0, s.challengeEvery - (state.salesSinceChallenge ?? 0));
  const every = s.challengeEvery > 0 ? `every ${s.challengeEvery} player${s.challengeEvery > 1 ? 's' : ''} sold` : 'whenever the host decides';
  const howItWorks = {
    auto: `Automatic: ${every}, the auction pauses and the server spins both wheels for everyone to watch. The host can also spin any time.`,
    host: `Host spins: ${every}, the next player waits until the host spins. The host can also spin whenever they like.`,
    rotation: `Teams take turns: ${every}, it's the next franchise's turn to press Spin (order: ${Object.keys(state.teams).join(' → ')}). The host can always spin too.`,
  }[s.spinBy];
  const status = !live ? 'The wheels unlock once the auction is live.'
    : spinning ? 'Spinning…'
    : run && run.stage !== 'team' ? 'Waiting for the current challenge to be resolved.'
    : run?.stage === 'team' ? (spinner ? `${teamName(run.teamId!)} was picked. Now spin the challenge wheel!` : `${teamName(run.teamId!)} was picked. Waiting for the challenge wheel…`)
    : queued ? 'Spin queued: the wheels spin as soon as the current player is sold or unsold.'
    : state.challengeDue ? (s.spinBy === 'auto' ? 'Challenge due: the wheels spin automatically in a moment…' : s.spinBy === 'rotation' ? `Challenge due: ${turnTeam ? teamName(turnTeam) : '—'} spins now${myTurn ? ' (that’s you!)' : ''}.` : isHost ? 'Challenge due: spin the wheels to continue the auction.' : 'Challenge due: waiting for the host to spin.')
    : state.lot ? (isHost ? 'A player is on the block. Pressing Spin queues the challenge for right after this player.' : s.challengeEvery > 0 ? `Next challenge after ${left} more sale${left === 1 ? '' : 's'}.` : 'Waiting for the host.')
    : spinner ? 'Spin the team wheel first, then the challenge wheel.'
    : s.challengeEvery > 0 ? `Next challenge after ${left} more sale${left === 1 ? '' : 's'}.` : 'Waiting for the host.';

  if (!s.challengesEnabled) return <Empty>Challenges are switched off for this room. The host can enable them in Settings.</Empty>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="display text-3xl text-white">Challenge <span className="text-gold">Arena</span></h2>
          <p className={`text-sm ${state.challengeDue || run ? 'font-semibold text-gold' : 'text-slate-400'}`} aria-live="polite">{status}</p></div>
        {isHost && live && <button className="btn-ghost" disabled={!!state.lot || spinning || (!!run && run.stage !== 'team')} onClick={() => act('ch.surprise')}><Zap size={16} className="text-gold" />Surprise event (both wheels)</button>}
      </div>

      <div className="flex gap-3 rounded-xl border border-ink-500 bg-ink-800/70 p-3 text-sm text-slate-300">
        <Info size={18} className="mt-0.5 shrink-0 text-gold" />
        <div><b className="text-white">How the wheels work.</b> {howItWorks} Wheel 1 picks a team, wheel 2 picks that team's challenge, and the effect is applied to the real auction straight away.
          {s.challengeEvery > 0 && live && <span className="ml-1 text-slate-400">Next challenge in <b className="text-white">{state.challengeDue ? 'now' : `${left} sale${left === 1 ? '' : 's'}`}</b>.</span>}
          {isHost && <span className="ml-1 text-slate-500">Change the mode and frequency in Settings → Challenge Arena.</span>}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5 text-center">
          <h3 className="h-section !text-base">1 · Team selection wheel</h3>
          <div className="my-4">{teamSlices.length ? <Wheel slices={teamSlices} spin={state.teamWheel} onSettled={setTeamDone} /> : <Empty>No teams yet</Empty>}</div>
          <div className="flex min-h-[52px] items-center justify-center">
            <AnimatePresence mode="wait">
              {pickedTeam ? <motion.div key={state.teamWheel!.nonce} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="flex items-center gap-3"><TeamBadge id={pickedTeam} size={48} ring /><span className="display text-2xl text-white">{teamName(pickedTeam)}</span></motion.div>
                : <span className="text-sm text-slate-500">{teamSpinning ? 'Spinning…' : 'Which franchise is it going to be?'}</span>}
            </AnimatePresence>
          </div>
          {showButtons && <button className="btn-gold mt-3 w-full" disabled={!canSpinTeam} onClick={() => act('ch.spinTeam')}><Sparkles size={16} />{queued ? 'Queued — spins after this player' : state.lot ? 'Queue a spin after this player' : run?.stage === 'team' && !teamSpinning ? 'Re-spin team wheel' : myTurn ? 'Your turn — spin the wheel!' : 'Spin the wheel'}</button>}
        </div>

        <div className="card p-5 text-center">
          <h3 className="h-section !text-base">2 · Challenge wheel</h3>
          <div className="my-4">{chSlices.length ? <Wheel slices={chSlices} spin={state.challengeWheel} onSettled={setChDone} /> : <Empty>No challenges enabled</Empty>}</div>
          <div className="flex min-h-[52px] items-center justify-center">
            <AnimatePresence mode="wait">
              {pickedCh ? <motion.div key={state.challengeWheel!.nonce} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}><span className="chip mb-1" style={{ background: `${CAT_COLOR[pickedCh.category]}26`, color: CAT_COLOR[pickedCh.category] }}>{pickedCh.category}</span><div className="display text-xl leading-tight text-white">{pickedCh.text}</div></motion.div>
                : <span className="text-sm text-slate-500">{chSpinning ? 'Spinning…' : 'Pick a team first, then spin for their fate'}</span>}
            </AnimatePresence>
          </div>
          {showButtons && <button className="btn-gold mt-3 w-full" disabled={!canSpinCh} onClick={() => act('ch.spinChallenge')}><Sparkles size={16} />Spin the challenge wheel</button>}
        </div>
      </div>

      {run && run.stage !== 'team' && !spinning && renderRun()}

      {isHost && live && (
        <div className="card flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[140px] flex-1"><Field label="Manually assign — team"><select value={assignTeam} onChange={(e) => setAssignTeam(e.target.value)}><option value="">Choose team</option>{teams.map((t) => <option key={t.id} value={t.id}>{teamName(t.id)}</option>)}</select></Field></div>
          <div className="min-w-[200px] flex-[2]"><Field label="Challenge"><select value={assignCh} onChange={(e) => setAssignCh(e.target.value)}><option value="">Choose challenge</option>{state.challenges.map((c) => <option key={c.id} value={c.id}>{c.category}: {c.text}</option>)}</select></Field></div>
          <button className="btn-ghost" disabled={!assignTeam || !assignCh || !!state.lot || spinning} onClick={() => act('ch.assign', { teamId: assignTeam, challengeId: assignCh })}>Assign without spinning</button>
        </div>
      )}

      <section className="card p-4">
        <h3 className="h-section mb-3 !text-base">Challenge history</h3>
        {history.length === 0 ? <Empty>No challenges yet. Fortune favours… someone.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="pb-2 pr-3">Time</th><th className="pb-2 pr-3">Team</th><th className="pb-2 pr-3">Challenge</th><th className="pb-2 pr-3">Status</th><th className="pb-2 pr-3">Result</th><th className="pb-2 pr-3">Budget</th><th className="pb-2">Released</th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id} className="border-t border-ink-600/70 align-top">
                <td className="py-2 pr-3 text-slate-500">{new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="py-2 pr-3"><span className="flex items-center gap-1.5"><TeamBadge id={h.teamId} size={22} /><span className="text-white">{h.teamId}</span></span></td>
                <td className="py-2 pr-3 text-slate-200">{h.text}</td>
                <td className="py-2 pr-3"><span className={`chip ${h.status === 'applied' ? 'bg-emerald-500/15 text-emerald-300' : h.status === 'rejected' ? 'bg-red-500/15 text-red-300' : 'bg-slate-500/15 text-slate-300'}`}>{h.status}</span></td>
                <td className="py-2 pr-3 text-slate-300">{h.result}</td>
                <td className={`py-2 pr-3 font-semibold ${h.budgetDelta > 0 ? 'text-emerald-300' : h.budgetDelta < 0 ? 'text-red-300' : 'text-slate-500'}`}>{h.budgetDelta ? `${h.budgetDelta > 0 ? '+' : ''}${fmt(h.budgetDelta)}` : '—'}</td>
                <td className="py-2 text-slate-300">{h.released.map((id) => map.get(id)?.name).join(', ') || '—'}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="h-section !text-base">Challenge deck <span className="text-xs font-medium normal-case tracking-normal text-slate-400">{state.challenges.filter((c) => c.enabled).length} enabled · {s.challengeMode === 'optional' ? 'teams may reject' : 'mandatory'} · {s.challengeRepeat ? 'repeats allowed' : 'no repeats'}</span></h3>
          {isHost && <button className="btn-ghost !py-1.5" onClick={() => setEditing({ text: '', effect: 'budget', amount: 0, weight: 1, enabled: true })}><Plus size={15} />Add custom</button>}</div>
        <ul className="grid gap-2 md:grid-cols-2">
          {state.challenges.map((c) => (
            <li key={c.id} className={`flex items-center gap-2.5 rounded-xl border border-ink-600 bg-ink-700/50 px-3 py-2 ${c.enabled ? '' : 'opacity-45'}`}>
              <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[c.category] }} title={c.category} />
              <div className="min-w-0 flex-1"><div className="truncate text-sm text-white" title={c.text}>{c.text}</div><div className="text-[11px] text-slate-500">{c.category} · weight {c.weight}{c.amount ? ` · ${Math.abs(c.amount) >= 10 ? fmt(c.amount) : c.amount}` : ''}</div></div>
              {isHost && <>
                <input type="checkbox" checked={c.enabled} aria-label={`Enable: ${c.text}`} onChange={(e) => act('ch.save', { challenge: { id: c.id, enabled: e.target.checked } })} />
                <button aria-label="Edit challenge" className="rounded p-1 text-slate-400 hover:bg-ink-500 hover:text-white" onClick={() => setEditing(c)}><Pencil size={14} /></button>
                <button aria-label="Delete challenge" className="rounded p-1 text-slate-400 hover:bg-red-500/20 hover:text-red-300" onClick={() => confirm('Delete this challenge?') && act('ch.delete', { id: c.id })}><Trash2 size={14} /></button>
              </>}
            </li>
          ))}
        </ul>
      </section>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit challenge' : 'New custom challenge'}>
        {editing && (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); if (await act('ch.save', { challenge: editing })) setEditing(null); }}>
            <Field label="Description shown on the wheel"><input autoFocus maxLength={120} value={editing.text ?? ''} onChange={(e) => setEditing({ ...editing, text: e.target.value })} placeholder="e.g. Sing your team anthem or lose ₹1 Cr" /></Field>
            <Field label="What it does to the auction"><select value={editing.effect} onChange={(e) => setEditing({ ...editing, effect: e.target.value as EffectType })}>{EFFECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount" hint={EFFECTS.find((x) => x[0] === editing.effect)?.[2] || 'Not used by this effect'}><input type="number" value={editing.amount ?? 0} onChange={(e) => setEditing({ ...editing, amount: +e.target.value })} /></Field>
              <Field label="Weight (probability)" hint="2 = twice as likely as 1"><input type="number" min={0.1} max={10} step={0.1} value={editing.weight ?? 1} onChange={(e) => setEditing({ ...editing, weight: +e.target.value })} /></Field>
            </div>
            <button className="btn-gold w-full">Save challenge</button>
          </form>
        )}
      </Modal>
    </div>
  );

  // ---- pending challenge: accept / choose / confirm ----
  function renderRun() {
    const c = challenge(run!.challengeId)!;
    const t = state.teams[run!.teamId!];
    const mine = t.ownerId === session.participantId;
    const actor = mine || isHost;
    const others = teams.filter((x) => x.id !== t.id);
    const owner = state.participants.find((p) => p.id === t.ownerId)?.name ?? 'the team';
    const names = (teamId: string) => state.teams[teamId].squad.map((e) => ({ id: e.playerId, label: `${map.get(e.playerId)?.name} (${fmt(e.price)})` }));
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card !border-gold/60 p-5 shadow-glow">
        <div className="flex flex-wrap items-center gap-3"><TeamBadge id={t.id} size={46} ring /><div className="min-w-0 flex-1"><div className="text-xs uppercase tracking-wider text-gold">Challenge for {teamName(t.id)}</div><div className="display text-2xl leading-tight text-white">{c.text}</div></div>
          {isHost && <button className="btn-danger !py-1.5" onClick={() => act('ch.cancel')}><X size={15} />Cancel</button>}</div>

        {run!.stage === 'accept' && (actor
          ? <div className="mt-4 flex gap-2"><button className="btn-green flex-1" onClick={() => act('ch.respond', { accept: true })}><Check size={16} />Accept challenge</button><button className="btn-danger flex-1" onClick={() => act('ch.respond', { accept: false })}><X size={16} />Reject</button></div>
          : <p className="mt-3 text-sm text-slate-400">Waiting for {owner} to accept or reject…</p>)}

        {run!.stage === 'input' && (!actor ? <p className="mt-3 text-sm text-slate-400">Waiting for {owner} to choose…</p> : (
          <div className="mt-4 space-y-3">
            {(c.effect === 'target_budget' || c.effect === 'target_skip') && <div><div className="mb-2 text-sm text-slate-300">Choose an opponent:</div><div className="flex flex-wrap gap-2">{others.map((o) => <button key={o.id} className="btn-ghost" onClick={() => act('ch.input', { targetTeam: o.id })}><TeamBadge id={o.id} size={24} />{o.id}</button>)}</div></div>}
            {c.effect === 'protect' && <div><div className="mb-2 text-sm text-slate-300">Choose a player to protect:</div><div className="flex flex-wrap gap-2">{t.squad.filter((e) => !e.protected).map((e) => <button key={e.playerId} className="btn-ghost" onClick={() => act('ch.input', { playerId: e.playerId })}>{map.get(e.playerId)?.name}</button>)}</div></div>}
            {c.effect === 'swap' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={`${t.id} gives`}><select value={mineP} onChange={(e) => setMineP(e.target.value)}><option value="">Choose player</option>{names(t.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
                <Field label="Swap with"><select value={target} onChange={(e) => { setTarget(e.target.value); setTheirs(''); }}><option value="">Choose team</option>{others.filter((o) => o.squad.length).map((o) => <option key={o.id} value={o.id}>{teamName(o.id)}</option>)}</select></Field>
                <Field label="For their"><select value={theirs} disabled={!target} onChange={(e) => setTheirs(e.target.value)}><option value="">Choose player</option>{target && names(target).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
                <button className="btn-gold sm:col-span-2" disabled={!mineP || !theirs} onClick={() => act('ch.input', { myPlayer: mineP, targetTeam: target, theirPlayer: theirs })}>Propose swap</button>
              </div>
            )}
            <button className="text-xs text-slate-400 underline" onClick={() => act('ch.input', { pass: true })}>Pass on this challenge</button>
          </div>
        ))}

        {run!.stage === 'swap_confirm' && run!.swap && (() => {
          const sw = run!.swap!, theirTeam = state.teams[sw.targetTeam];
          const canConfirm = theirTeam.ownerId === session.participantId || isHost;
          return (
            <div className="mt-4">
              <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl bg-ink-700/70 p-3 text-sm"><TeamBadge id={t.id} size={28} /><b className="text-white">{map.get(sw.myPlayer)?.name}</b><span className="text-gold">⇄</span><b className="text-white">{map.get(sw.theirPlayer)?.name}</b><TeamBadge id={sw.targetTeam} size={28} /></div>
              {canConfirm ? <div className="mt-3 flex gap-2"><button className="btn-green flex-1" onClick={() => act('ch.swapRespond', { accept: true })}>Agree to swap</button><button className="btn-danger flex-1" onClick={() => act('ch.swapRespond', { accept: false })}>Decline</button></div>
                : <p className="mt-3 text-center text-sm text-slate-400">Waiting for {teamName(sw.targetTeam)} to agree…</p>}
            </div>
          );
        })()}
        {myTeam?.id === t.id && run!.stage === 'accept' && <p className="mt-2 text-xs text-slate-500">This room lets the selected team decide.</p>}
      </motion.div>
    );
  }
}
