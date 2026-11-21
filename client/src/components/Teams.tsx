import { AlertTriangle, GitCompareArrows, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmt, franchise, maxBid, ROLE_LABEL, teamName, type Role, type TeamState } from '../../../shared/types';
import { summarize } from '../analytics';
import { restrictionList } from '../rules';
import { useOpenPlayer, usePlayers, useRoom } from '../store';
import { Avatar, Empty, Flag, PurseBar, RoleChip, TeamBadge, Tile } from './ui';

export default function Teams() {
  const { state, myTeam } = useRoom();
  const teams = Object.values(state.teams);
  const [sel, setSel] = useState(myTeam?.id ?? teams[0]?.id ?? '');
  const [cmp, setCmp] = useState('');
  if (!teams.length) return <Empty>No franchises have been picked yet.</Empty>;
  const a = state.teams[sel] ?? teams[0];
  const b = cmp ? state.teams[cmp] : null;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {teams.map((t) => (
          <button key={t.id} onClick={() => { setSel(t.id); if (cmp === t.id) setCmp(''); }} aria-pressed={a.id === t.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm font-semibold transition ${a.id === t.id ? 'border-gold bg-gold/10 text-white' : 'border-ink-500 bg-ink-800 text-slate-300 hover:bg-ink-700'}`}>
            <TeamBadge id={t.id} size={26} />{t.id}{t.id === myTeam?.id && <span className="text-[10px] text-gold">YOU</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2"><GitCompareArrows size={16} className="text-slate-400" />
          <select className="!w-auto" value={cmp} onChange={(e) => setCmp(e.target.value)} aria-label="Compare with"><option value="">Compare with…</option>{teams.filter((t) => t.id !== a.id).map((t) => <option key={t.id} value={t.id}>{teamName(t.id)}</option>)}</select></div>
      </div>
      <div className={`grid gap-4 ${b ? 'lg:grid-cols-2' : ''}`}><Dashboard team={a} against={b} />{b && <Dashboard team={b} against={a} />}</div>
    </div>
  );
}

export function Dashboard({ team, against, compact = false }: { team: TeamState; against?: TeamState | null; compact?: boolean }) {
  const { state, session, act } = useRoom();
  const { map } = usePlayers();
  const open = useOpenPlayer();
  const s = state.settings;
  const sum = useMemo(() => summarize(team, map, s), [team, map, s]);
  const all = useMemo(() => Object.values(state.teams).map((t) => summarize(t, map, s)), [state.teams, map, s]);
  const other = against ? summarize(against, map, s) : null;
  const f = franchise(team.id);
  const owner = state.participants.find((p) => p.id === team.ownerId);
  const mine = team.ownerId === session.participantId;
  const max = (k: 'batting' | 'bowling' | 'experience') => Math.max(1, ...all.map((x) => x[k]));
  const rs = restrictionList(team);
  const squad = [...team.squad].sort((x, y) => y.price - x.price);
  const order: Role[] = ['BAT', 'WK', 'AR', 'BOWL'];
  const better = (mineV: number, theirs?: number) => (theirs == null ? '' : mineV > theirs ? 'text-emerald-300' : mineV < theirs ? 'text-red-300' : '');

  return (
    <div className="card overflow-hidden">
      <div className="relative p-4" style={{ background: `linear-gradient(120deg, ${f?.color}33, transparent 60%)` }}>
        <div className="flex items-center gap-3"><TeamBadge id={team.id} size={56} />
          <div className="min-w-0 flex-1"><h2 className="display truncate text-2xl leading-none text-white">{teamName(team.id)}</h2><div className="mt-1 text-sm text-slate-300">{owner ? `Managed by ${owner.name}` : 'No manager'}{mine ? ' (you)' : ''}</div></div>
          <div className="text-right"><div className="text-[10px] uppercase tracking-wider text-slate-400">Remaining</div><div className={`font-display text-3xl font-bold ${better(team.purse, against?.purse) || 'text-gold'}`}>{fmt(team.purse)}</div></div>
        </div>
        <div className="mt-3"><PurseBar team={team} /></div>
      </div>

      <div className="space-y-4 p-4">
        <div className={`grid grid-cols-2 gap-2 ${compact ? '' : 'sm:grid-cols-4'}`}>
          <Tile label="Initial purse" value={fmt(team.initialPurse)} /><Tile label="Total spent" value={fmt(team.initialPurse - team.purse)} sub={team.initialPurse - team.purse !== sum.spent ? `${fmt(sum.spent)} on current squad` : undefined} />
          <Tile label="Players" value={`${sum.count}/${s.maxSquad}`} sub={`${Math.max(0, s.maxSquad - sum.count)} slots left · min ${s.minSquad}`} /><Tile label="Max next bid" value={fmt(maxBid(team, s))} accent />
          <Tile label="Indian" value={sum.indian} /><Tile label="Overseas" value={`${sum.overseas}/${s.maxOverseas}`} />
          {s.rtmEnabled && <Tile label="RTM cards" value={team.rtmLeft} />}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {order.map((r) => <div key={r} className="rounded-xl bg-ink-700/60 py-2 text-center"><div className={`font-display text-2xl font-bold ${better(sum.roles[r], other?.roles[r]) || 'text-white'}`}>{sum.roles[r]}</div><div className="text-[10px] uppercase tracking-wider text-slate-400">{ROLE_LABEL[r]}s</div></div>)}
        </div>

        <div className="space-y-2">
          {([['Batting strength', 'batting', `${sum.batting.toLocaleString()} career IPL runs (top 7)`], ['Bowling strength', 'bowling', `${sum.bowling} career IPL wickets (top 5)`], ['Experience', 'experience', `${sum.experience} IPL appearances`]] as const).map(([label, k, note]) => (
            <div key={k}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-slate-300">{label}</span><span className="text-slate-500">{note}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-600"><div className="h-full rounded-full bg-gradient-to-r from-volt to-emerald-400 transition-all duration-500" style={{ width: `${(sum[k] / max(k)) * 100}%` }} /></div></div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            <span className={`chip ${sum.roles.AR >= 2 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>All-rounder depth: {sum.roles.AR}</span>
            <span className={`chip ${sum.roles.WK ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>{sum.roles.WK ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}Wicketkeepers: {sum.roles.WK}</span>
            {rs.map((r) => <span key={r} className="chip bg-violet-500/15 text-violet-300">{r}</span>)}
          </div>
        </div>

        {state.phase !== 'lobby' && sum.warnings.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200">{sum.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{w}</li>)}</ul>
        )}
        {mine && team.r.releaseFirst && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">A challenge requires you to release one player before you can bid again. Choose a player below ({s.releaseRefundPct}% of the price is refunded).</p>}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Squad</h3>
          {!squad.length ? <Empty>No players yet.</Empty> : (
            <ul className="space-y-1.5">
              {squad.map((e) => { const p = map.get(e.playerId); if (!p) return null; return (
                <li key={e.playerId} className="flex items-center gap-2.5 rounded-xl bg-ink-700/50 p-1.5">
                  <button onClick={() => open(p.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    <Avatar p={p} className="h-11 w-11 shrink-0 rounded-lg text-[7px]" />
                    <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold text-white">{p.name}</span>{e.protected && <ShieldCheck size={13} className="shrink-0 text-emerald-400" aria-label="Protected from release" />}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400"><RoleChip role={p.role} /><Flag country={p.nationality} />{p.nationality}{e.via !== 'auction' && <span className="chip bg-ink-500 !py-0 text-slate-300">{e.via}</span>}</span></span>
                  </button>
                  <span className="shrink-0 pr-1 font-display text-lg font-bold text-gold">{fmt(e.price)}</span>
                  {mine && team.r.releaseFirst && <button className="btn-danger !px-2 !py-1 !text-xs" onClick={() => confirm(`Release ${p.name}?`) && act('release', { playerId: p.id })}>Release</button>}
                </li>); })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
