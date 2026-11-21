import { motion } from 'framer-motion';
import { Award as AwardIcon, ChevronDown, Download, Printer, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fmt, franchise, ROLE_LABEL, teamName, type Role, type Sale } from '../../../shared/types';
import { awards, download, reportCsv, summarize } from '../analytics';
import { api, useOpenPlayer, usePlayers, useRoom } from '../store';
import { Dashboard } from './Teams';
import { Empty, TeamBadge, Tile } from './ui';

const barColor = (id: string) => { const f = franchise(id); return f ? (f.color === '#1B2A4A' ? f.color2 : f.color) : '#5b8cff'; };

function Bars({ title, rows, format = fmt }: { title: string; rows: { key: string; label: React.ReactNode; value: number; color: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="card p-4">
      <h3 className="h-section mb-3 !text-base">{title}</h3>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[84px_1fr_78px] items-center gap-2 text-sm">
            <span className="flex items-center gap-1.5 truncate text-slate-300">{r.label}</span>
            <span className="h-4 overflow-hidden rounded bg-ink-600"><motion.span className="block h-full rounded" style={{ background: r.color }} initial={{ width: 0 }} animate={{ width: `${(r.value / max) * 100}%` }} transition={{ duration: 0.6 }} /></span>
            <span className="text-right font-display text-base font-bold text-white">{format(r.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stats() {
  const { state } = useRoom();
  const { map } = usePlayers();
  const open = useOpenPlayer();
  const teams = Object.values(state.teams);
  const sales = state.sales;
  const d = useMemo(() => {
    const by = (f: (x: Sale) => number) => (sales.length ? sales.reduce((a, b) => (f(b) > f(a) ? b : a)) : null);
    const total = sales.reduce((a, x) => a + x.price, 0);
    const role = (r: Role) => sales.filter((x) => map.get(x.playerId)?.role === r);
    const topRole = (r: Role) => role(r).sort((a, b) => b.price - a.price)[0] ?? null;
    const os = sales.filter((x) => map.get(x.playerId)?.overseas);
    const osSpend = os.reduce((a, x) => a + x.price, 0);
    const spend = (id: string) => state.teams[id].initialPurse - state.teams[id].purse;
    return {
      total, most: by((x) => x.price), least: by((x) => -x.price), avg: sales.length ? Math.round(total / sales.length) : 0, topRole, role, osSpend, osCount: os.length,
      topSpender: teams.length ? teams.reduce((a, b) => (spend(b.id) > spend(a.id) ? b : a)) : null,
      richest: teams.length ? teams.reduce((a, b) => (b.purse > a.purse ? b : a)) : null, spend,
      unsold: Object.values(state.status).filter((x) => x === 'unsold').length,
    };
  }, [sales, state.teams, state.status, map]); // eslint-disable-line react-hooks/exhaustive-deps
  const nm = (x: Sale | null) => (x ? map.get(x.playerId)?.name : '—');
  const sub = (x: Sale | null) => (x ? `${fmt(x.price)} · ${x.teamId}` : 'No sales yet');
  const teamBest = teams.map((t) => ({ t, best: sales.filter((x) => x.teamId === t.id).sort((a, b) => b.price - a.price)[0] }));

  return (
    <div className="space-y-4">
      <h2 className="h-section">Auction statistics</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Players sold" value={sales.length} sub={`${d.unsold} unsold`} /><Tile label="Total spent" value={fmt(d.total)} accent /><Tile label="Average price" value={fmt(d.avg)} />
        <Tile label="Most expensive" value={nm(d.most)} sub={sub(d.most)} /><Tile label="Cheapest" value={nm(d.least)} sub={sub(d.least)} />
        <Tile label="Highest spender" value={d.topSpender ? d.topSpender.id : '—'} sub={d.topSpender ? fmt(d.spend(d.topSpender.id)) : ''} />
        <Tile label="Most purse left" value={d.richest ? d.richest.id : '—'} sub={d.richest ? fmt(d.richest.purse) : ''} />
        <Tile label="Top batter" value={nm(d.topRole('BAT'))} sub={sub(d.topRole('BAT'))} /><Tile label="Top bowler" value={nm(d.topRole('BOWL'))} sub={sub(d.topRole('BOWL'))} />
        <Tile label="Top all-rounder" value={nm(d.topRole('AR'))} sub={sub(d.topRole('AR'))} /><Tile label="Top keeper" value={nm(d.topRole('WK'))} sub={sub(d.topRole('WK'))} />
        <Tile label="Challenges played" value={state.challengeLog.length} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Bars title="Spending by team" rows={teams.map((t) => ({ key: t.id, label: <><TeamBadge id={t.id} size={20} />{t.id}</>, value: d.spend(t.id), color: barColor(t.id) }))} />
        <Bars title="Remaining purse" rows={teams.map((t) => ({ key: t.id, label: <><TeamBadge id={t.id} size={20} />{t.id}</>, value: t.purse, color: barColor(t.id) }))} />
        <Bars title="Spending by role" rows={(['BAT', 'WK', 'AR', 'BOWL'] as Role[]).map((r, i) => ({ key: r, label: `${ROLE_LABEL[r]}s`, value: d.role(r).reduce((a, x) => a + x.price, 0), color: ['#38bdf8', '#a78bfa', '#34d399', '#fb7185'][i] }))} />
        <Bars title="Indian vs overseas spending" rows={[{ key: 'in', label: `Indian (${sales.length - d.osCount})`, value: d.total - d.osSpend, color: '#f59e0b' }, { key: 'os', label: `Overseas (${d.osCount})`, value: d.osSpend, color: '#5b8cff' }]} />
      </div>
      <div className="card p-4">
        <h3 className="h-section mb-3 !text-base">Most expensive purchase by team</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {teamBest.map(({ t, best }) => (
            <button key={t.id} disabled={!best} onClick={() => best && open(best.playerId)} className="flex items-center gap-3 rounded-xl bg-ink-700/60 p-2.5 text-left hover:bg-ink-600 disabled:hover:bg-ink-700/60">
              <TeamBadge id={t.id} size={36} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{best ? map.get(best.playerId)?.name : 'No purchases yet'}</span><span className="text-xs text-slate-400">{teamName(t.id)}</span></span>
              {best && <span className="font-display text-lg font-bold text-gold">{fmt(best.price)}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Tx { id: number; franchise: string; type: string; amount: number; balanceAfter: number; note: string; createdAt: string }

export function HistoryTab() {
  const { state, session } = useRoom();
  const { map } = usePlayers();
  const open = useOpenPlayer();
  const [view, setView] = useState<'sales' | 'log' | 'ledger'>('sales');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tx, setTx] = useState<Tx[] | null>(null);
  useEffect(() => {
    if (view !== 'ledger') return;
    api<Tx[]>(`/rooms/${state.code}/transactions?pid=${session.participantId}&token=${session.token}`).then(setTx).catch(() => setTx([]));
  }, [view, state.sales.length, state.challengeLog.length, state.code, session]);
  const sales = [...state.sales].reverse();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="h-section mr-auto">Auction history</h2>
        <div className="flex overflow-hidden rounded-xl border border-ink-500 text-xs font-semibold">
          {([['sales', `Sales (${state.sales.length})`], ['log', 'Event log'], ['ledger', 'Purse ledger']] as const).map(([v, l]) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? 'bg-gold text-ink-950' : 'bg-ink-800 text-slate-300 hover:bg-ink-700'}`}>{l}</button>)}
        </div>
        <button className="btn-ghost !py-1.5" onClick={() => download(`auction-${state.code}.csv`, reportCsv(state, map))}><Download size={15} />CSV</button>
      </div>

      {view === 'sales' && (sales.length === 0 ? <Empty>No players have been sold yet.</Empty> : (
        <ul className="space-y-1.5">
          {sales.map((x) => { const p = map.get(x.playerId); return (
            <li key={x.id} className="card !rounded-xl">
              <div className="flex items-center gap-3 p-2.5">
                <span className="w-8 text-center font-display text-sm text-slate-500">#{x.lotNo}</span><TeamBadge id={x.teamId} size={32} />
                <button className="min-w-0 flex-1 text-left" onClick={() => open(x.playerId)}><span className="block truncate text-sm font-semibold text-white">{p?.name}</span><span className="text-xs text-slate-400">{p?.role} · {teamName(x.teamId)}{x.via === 'rtm' ? ' · RTM' : ''} · {new Date(x.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></button>
                <span className="font-display text-xl font-bold text-gold">{fmt(x.price)}</span>
                <button aria-label="Show bids" aria-expanded={expanded === x.id} onClick={() => setExpanded(expanded === x.id ? null : x.id)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:bg-ink-600">{x.bids.length} bids<ChevronDown size={14} className={expanded === x.id ? 'rotate-180' : ''} /></button>
              </div>
              {expanded === x.id && <ol className="flex flex-wrap gap-1.5 border-t border-ink-600 p-2.5 text-xs">{x.bids.map((b, i) => <li key={i} className="flex items-center gap-1 rounded-md bg-ink-700 px-1.5 py-1"><TeamBadge id={b.teamId} size={16} /><span className="text-slate-200">{fmt(b.amount)}</span></li>)}</ol>}
            </li>); })}
        </ul>
      ))}

      {view === 'log' && (
        <ul className="card divide-y divide-ink-600/70 text-sm">
          {[...state.log].reverse().filter((e) => e.kind !== 'chat').map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2"><span className="w-14 shrink-0 text-xs text-slate-500">{new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{e.teamId ? <TeamBadge id={e.teamId} size={20} /> : <span className="w-5" />}<span className="text-slate-200">{e.text}</span><span className="chip ml-auto bg-ink-600 text-slate-400">{e.kind}</span></li>
          ))}
        </ul>
      )}

      {view === 'ledger' && (!tx ? <Empty>Loading the ledger…</Empty> : tx.length === 0 ? <Empty>No purse movements recorded yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="p-2.5">Time</th><th className="p-2.5">Team</th><th className="p-2.5">Type</th><th className="p-2.5">Detail</th><th className="p-2.5 text-right">Amount</th><th className="p-2.5 text-right">Balance</th></tr></thead>
          <tbody>{[...tx].reverse().map((t) => (
            <tr key={t.id} className="border-t border-ink-600/70"><td className="p-2.5 text-slate-500">{new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td className="p-2.5"><span className="flex items-center gap-1.5 text-white"><TeamBadge id={t.franchise} size={20} />{t.franchise}</span></td>
              <td className="p-2.5"><span className="chip bg-ink-600 text-slate-300">{t.type.replace('_', ' ')}</span></td><td className="p-2.5 text-slate-300">{t.note}</td>
              <td className={`p-2.5 text-right font-semibold ${t.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{t.amount >= 0 ? '+' : ''}{fmt(t.amount)}</td><td className="p-2.5 text-right text-white">{fmt(t.balanceAfter)}</td></tr>))}</tbody>
        </table></div>
      ))}
    </div>
  );
}

export function Results() {
  const { state } = useRoom();
  const { map } = usePlayers();
  const teams = Object.values(state.teams);
  const list = useMemo(() => awards(state, map), [state, map]);
  const [a, setA] = useState(teams[0]?.id ?? '');
  const [b, setB] = useState(teams[1]?.id ?? '');
  const best = (id: string) => state.teams[id].squad.map((e) => ({ e, p: map.get(e.playerId)! })).filter((x) => x.p).sort((x, y) => y.p.matches / Math.max(10, y.e.price) - x.p.matches / Math.max(10, x.e.price)).slice(0, 2);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><span className="chip mb-1 bg-gold/15 text-gold"><Trophy size={12} />Auction complete</span><h2 className="display text-4xl text-white">{state.name} — Final results</h2>
          <p className="text-sm text-slate-400">{state.sales.length} player{state.sales.length === 1 ? '' : 's'} sold for {fmt(state.sales.reduce((x, y) => x + y.price, 0))} across {teams.length} teams</p></div>
        <div className="no-print flex gap-2"><button className="btn-ghost" onClick={() => download(`auction-${state.code}.csv`, reportCsv(state, map))}><Download size={16} />Download CSV</button><button className="btn-gold" onClick={() => window.print()}><Printer size={16} />Save as PDF</button></div>
      </div>

      {list.length > 0 && (
        <section><h3 className="h-section mb-3">Awards</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((w, i) => (
              <motion.div key={w.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="card flex items-center gap-3 p-4" title={w.method}>
                {w.teamId ? <TeamBadge id={w.teamId} size={48} /> : <AwardIcon className="text-gold" size={40} />}
                <div className="min-w-0"><div className="text-[11px] font-semibold uppercase tracking-wider text-gold">{w.title}</div><div className="display truncate text-xl text-white">{w.winner}</div><div className="truncate text-xs text-slate-400">{w.detail}</div><div className="mt-0.5 text-[10px] text-slate-500">{w.method}</div></div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <section><h3 className="h-section mb-3">All squads</h3>
        <div className="flex gap-4 overflow-x-auto pb-3 print:flex-wrap">
          {teams.map((t) => { const x = summarize(t, map, state.settings); return (
            <div key={t.id} className="card w-[290px] shrink-0 overflow-hidden">
              <div className="flex items-center gap-2.5 p-3" style={{ background: `linear-gradient(120deg, ${franchise(t.id)?.color}40, transparent 70%)` }}><TeamBadge id={t.id} size={40} /><div className="min-w-0"><div className="truncate font-display text-lg font-bold text-white">{teamName(t.id)}</div><div className="text-xs text-slate-300">{state.participants.find((p) => p.id === t.ownerId)?.name ?? '—'}</div></div></div>
              <div className="grid grid-cols-3 gap-1 px-3 text-center text-xs"><div><div className="font-display text-lg font-bold text-white">{fmt(x.spent)}</div><div className="text-slate-500">spent</div></div><div><div className="font-display text-lg font-bold text-gold">{fmt(t.purse)}</div><div className="text-slate-500">left</div></div><div><div className="font-display text-lg font-bold text-white">{x.count}</div><div className="text-slate-500">{x.count === 1 ? 'player' : 'players'}</div></div></div>
              <div className="px-3 pt-2 text-[11px] text-slate-400">{x.roles.BAT} BAT · {x.roles.WK} WK · {x.roles.AR} AR · {x.roles.BOWL} BOWL · {x.overseas} overseas</div>
              {best(t.id).length > 0 && <div className="px-3 pt-1 text-[11px] text-emerald-300">Best value: {best(t.id).map((v) => v.p.name).join(', ')}</div>}
              <ul className="mt-2 max-h-[360px] space-y-0.5 overflow-y-auto border-t border-ink-600 p-2 text-xs print:max-h-none">
                {[...t.squad].sort((p, q) => q.price - p.price).map((e) => { const p = map.get(e.playerId); return p && <li key={e.playerId} className="flex justify-between gap-2 rounded px-1.5 py-1 odd:bg-ink-700/40"><span className="truncate text-slate-200">{p.name} <span className="text-slate-500">{p.role}{p.overseas ? ' ✈' : ''}</span></span><span className="shrink-0 font-semibold text-gold">{fmt(e.price)}</span></li>; })}
                {!t.squad.length && <li className="px-1.5 py-1 text-slate-500">No players</li>}
              </ul>
            </div>); })}
        </div>
      </section>

      {teams.length >= 2 && (
        <section className="no-print"><h3 className="h-section mb-3">Compare two teams</h3>
          <div className="mb-3 flex flex-wrap gap-2"><select className="!w-auto" value={a} onChange={(e) => setA(e.target.value)} aria-label="First team">{teams.map((t) => <option key={t.id} value={t.id}>{teamName(t.id)}</option>)}</select><span className="self-center text-slate-500">vs</span><select className="!w-auto" value={b} onChange={(e) => setB(e.target.value)} aria-label="Second team">{teams.map((t) => <option key={t.id} value={t.id}>{teamName(t.id)}</option>)}</select></div>
          {state.teams[a] && state.teams[b] && a !== b ? <div className="grid gap-4 lg:grid-cols-2"><Dashboard team={state.teams[a]} against={state.teams[b]} compact /><Dashboard team={state.teams[b]} against={state.teams[a]} compact /></div> : <Empty>Choose two different teams.</Empty>}
        </section>
      )}
      <p className="no-print text-sm text-slate-500">Every bid and transaction is in the History tab.</p>
    </div>
  );
}
