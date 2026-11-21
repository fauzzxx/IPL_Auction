import { Heart, Search, SlidersHorizontal, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEFUNCT, fmt, franchise, FRANCHISES, ROLE_LABEL, stat, teamName, type Player, type Role } from '../../../shared/types';
import { useOpenPlayer, usePlayers, useRoom } from '../store';
import { Avatar, crToLakh, Empty, Field, Flag, Modal, RoleChip, StatusChip, TeamBadge, Tile } from './ui';

const BASES = [30, 40, 50, 75, 100, 150, 200];
const BOWL_GROUPS: Record<string, (t: string | null) => boolean> = {
  'Fast': (t) => t === 'Fast', 'Fast-medium': (t) => t === 'Fast-medium' || t === 'Medium-fast', 'Medium pace': (t) => t === 'Medium',
  'All spinners': (t) => !!t && /spin|orthodox/i.test(t), 'Leg spin': (t) => t === 'Leg spin', 'Off spin': (t) => t === 'Off spin',
  'Left-arm orthodox': (t) => t === 'Left-arm orthodox', 'Left-arm wrist spin': (t) => t === 'Left-arm wrist spin',
};
const BAT_GROUPS = ['Opener', 'Top order', 'Middle order', 'Finisher'];

const Sel = ({ label, value, onChange, children }: any) => <Field label={label}><select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select></Field>;

export default function Catalogue() {
  const { state, poolSet, statusOf, owner, me } = useRoom();
  const { list } = usePlayers();
  const open = useOpenPlayer();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<'' | Role>('');
  const [sub, setSub] = useState('');
  const [nat, setNat] = useState('');
  const [origin, setOrigin] = useState('');
  const [base, setBase] = useState('');
  const [team, setTeam] = useState('');
  const [career, setCareer] = useState('');
  const [status, setStatus] = useState('all');
  const [scope, setScope] = useState<'pool' | 'all'>('pool');
  const [wish, setWish] = useState(false);
  const [sort, setSort] = useState('matches');
  const [limit, setLimit] = useState(48);
  const [showFilters, setShowFilters] = useState(false);

  const nations = useMemo(() => [...new Set(list.map((p) => p.nationality))].sort(), [list]);
  const baseOf = (p: Player) => state.baseOverrides[p.id] ?? p.basePrice;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = list.filter((p) => {
      if (scope === 'pool' && !poolSet.has(p.id)) return false;
      if (needle && !`${p.name} ${p.shortName} ${p.fullName ?? ''}`.toLowerCase().includes(needle)) return false;
      if (role && p.role !== role) return false;
      if (sub && !(BOWL_GROUPS[sub] ? BOWL_GROUPS[sub](p.bowlingType) : p.battingPosition === sub)) return false;
      if (nat && p.nationality !== nat) return false;
      if (origin && (origin === 'overseas') !== p.overseas) return false;
      if (base && baseOf(p) !== +base) return false;
      if (team && !p.teams.includes(team)) return false;
      if (career && (career === 'active') !== p.active) return false;
      if (wish && !me.wishlist.includes(p.id)) return false;
      const st = statusOf(p.id);
      if (status === 'available' && st !== 'upcoming' && st !== 'bidding') return false;
      if (status === 'sold' && st !== 'sold') return false;
      if (status === 'unsold' && st !== 'unsold') return false;
      return true;
    });
    const cmp: Record<string, (a: Player, b: Player) => number> = {
      matches: (a, b) => b.matches - a.matches, name: (a, b) => a.name.localeCompare(b.name), nameDesc: (a, b) => b.name.localeCompare(a.name),
      baseDesc: (a, b) => baseOf(b) - baseOf(a) || b.matches - a.matches, baseAsc: (a, b) => baseOf(a) - baseOf(b) || b.matches - a.matches,
      runs: (a, b) => b.stats.runs - a.stats.runs, wickets: (a, b) => b.stats.wickets - a.stats.wickets,
    };
    return out.sort(cmp[sort]);
  }, [list, q, role, sub, nat, origin, base, team, career, status, scope, wish, sort, poolSet, state.status, state.baseOverrides, me.wishlist]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setLimit(48), [q, role, sub, nat, origin, base, team, career, status, scope, wish, sort]);


  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="h-section mr-auto">Player catalogue <span className="text-sm font-medium normal-case tracking-normal text-slate-400">{rows.length} of {scope === 'pool' ? poolSet.size : list.length}</span></h2>
        <div className="flex overflow-hidden rounded-xl border border-ink-500 text-xs font-semibold" role="group" aria-label="Auction status">
          {[['all', 'All'], ['available', 'Available'], ['sold', 'Sold'], ['unsold', 'Unsold']].map(([v, l]) => <button key={v} aria-pressed={status === v} onClick={() => setStatus(v)} className={`px-3 py-1.5 ${status === v ? 'bg-gold text-ink-950' : 'bg-ink-800 text-slate-300 hover:bg-ink-700'}`}>{l}</button>)}
        </div>
      </div>
      <div className="card mb-4 p-3">
        <div className="flex gap-2">
          <div className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="!pl-9" placeholder="Search players by name…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" /></div>
          <button className="btn-ghost sm:hidden" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}><SlidersHorizontal size={16} />Filters</button>
          <button className={`btn-ghost ${wish ? '!border-rose-400 !text-rose-300' : ''}`} aria-pressed={wish} onClick={() => setWish(!wish)}><Heart size={16} className={wish ? 'fill-current' : ''} /><span className="hidden sm:inline">Wishlist</span> ({me.wishlist.length})</button>
        </div>
        <div className={`mt-3 grid-cols-2 gap-2 sm:grid sm:grid-cols-4 xl:grid-cols-8 ${showFilters ? 'grid' : 'hidden'}`}>
          <Sel label="Role" value={role} onChange={(v: any) => { setRole(v); setSub(''); }}><option value="">All roles</option>{(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}s</option>)}</Sel>
          <Sel label="Speciality" value={sub} onChange={setSub}><option value="">Any</option>
            {role !== 'BOWL' && <optgroup label="Batting position">{BAT_GROUPS.map((g) => <option key={g}>{g}</option>)}</optgroup>}
            {role !== 'BAT' && role !== 'WK' && <optgroup label="Bowling type">{Object.keys(BOWL_GROUPS).map((g) => <option key={g}>{g}</option>)}</optgroup>}</Sel>
          <Sel label="Indian / Overseas" value={origin} onChange={setOrigin}><option value="">Both</option><option value="indian">Indian</option><option value="overseas">Overseas</option></Sel>
          <Sel label="Nationality" value={nat} onChange={setNat}><option value="">All countries</option>{nations.map((n) => <option key={n}>{n}</option>)}</Sel>
          <Sel label="Base price" value={base} onChange={setBase}><option value="">Any</option>{BASES.map((b) => <option key={b} value={b}>{fmt(b)}</option>)}</Sel>
          <Sel label="IPL team" value={team} onChange={setTeam}><option value="">Any team</option>{FRANCHISES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}{Object.entries(DEFUNCT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Sel>
          <Sel label="Career status" value={career} onChange={setCareer}><option value="">Active & former</option><option value="active">Active (played latest season)</option><option value="former">Former / retired</option></Sel>
          <Sel label="Sort by" value={sort} onChange={setSort}><option value="matches">IPL appearances</option><option value="name">Name A–Z</option><option value="nameDesc">Name Z–A</option><option value="baseDesc">Base price high–low</option><option value="baseAsc">Base price low–high</option><option value="runs">Runs</option><option value="wickets">Wickets</option></Sel>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
          <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" className="!w-auto" checked={scope === 'pool'} onChange={() => setScope('pool')} />This auction's pool</label>
          <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" className="!w-auto" checked={scope === 'all'} onChange={() => setScope('all')} />Entire IPL database ({list.length})</label>
        </div>
      </div>

      {rows.length === 0 ? <Empty>No players match these filters.</Empty> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {rows.slice(0, limit).map((p) => {
            const st = statusOf(p.id), own = owner.get(p.id);
            const price = own ? state.teams[own].squad.find((e) => e.playerId === p.id)?.price : undefined;
            return (
              <button key={p.id} onClick={() => open(p.id)} className={`card group overflow-hidden text-left transition hover:-translate-y-0.5 hover:!border-slate-400 ${st === 'bidding' ? '!border-gold ring-2 ring-gold/40' : ''}`}>
                <div className="relative">
                  <Avatar p={p} className="aspect-[4/3] w-full text-xl" />
                  <span className="absolute left-2 top-2 rounded-md bg-ink-950/85 backdrop-blur"><StatusChip status={st} /></span>
                  {me.wishlist.includes(p.id) && <Heart size={16} className="absolute right-2 top-2 fill-rose-500 text-rose-500" />}
                  {own && <span className="absolute bottom-2 right-2"><TeamBadge id={own} size={30} ring /></span>}
                </div>
                <div className="p-2.5">
                  <div className="flex items-center gap-1.5"><Flag country={p.nationality} /><span className="truncate text-sm font-semibold text-white">{p.name}</span></div>
                  <div className="mt-1 flex items-center justify-between gap-1"><RoleChip role={p.role} /><span className="font-display text-base font-bold text-gold">{price != null ? fmt(price) : fmt(baseOf(p))}</span></div>
                  <div className="mt-1.5 truncate text-[11px] text-slate-400">{[p.battingStyle && `${p.battingStyle.replace('-handed', '')} bat`, p.bowlingStyle].filter(Boolean).join(' · ') || 'Style not recorded'}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1">{p.teams.slice(0, 5).map((t) => <span key={t} title={teamName(t)} className="rounded px-1 text-[10px] font-bold" style={{ background: franchise(t)?.color ?? '#27345c', color: franchise(t)?.text ?? '#cbd5e1' }}>{t}</span>)}{p.teams.length > 5 && <span className="text-[10px] text-slate-500">+{p.teams.length - 5}</span>}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {rows.length > limit && <div className="mt-5 text-center"><button className="btn-ghost" onClick={() => setLimit(limit + 60)}>Show more ({rows.length - limit} remaining)</button></div>}
    </div>
  );
}

export function PlayerModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { map } = usePlayers();
  const p = id ? map.get(id) : undefined;
  return <Modal open={!!p} onClose={onClose} wide title="Player profile">{p && <Profile p={p} onClose={onClose} />}</Modal>;
}

function Profile({ p, onClose }: { p: Player; onClose: () => void }) {
  const { state, statusOf, owner, me, act, isHost, myTeam, poolSet } = useRoom();
  const st = statusOf(p.id), own = owner.get(p.id);
  const sold = own ? state.teams[own].squad.find((e) => e.playerId === p.id) : undefined;
  const base = state.baseOverrides[p.id] ?? p.basePrice;
  const [custom, setCustom] = useState('');
  const wished = me.wishlist.includes(p.id);
  const canOpen = state.phase === 'auction' && !state.lot && !state.paused && poolSet.has(p.id) && (st === 'upcoming' || st === 'unsold');
  const s = p.stats;
  return (
    <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
      <div>
        <Avatar p={p} className="aspect-[4/5] w-full rounded-xl text-3xl" />
        <button className={`btn-ghost mt-3 w-full ${wished ? '!border-rose-400 !text-rose-300' : ''}`} onClick={() => act('wishlist.toggle', { playerId: p.id })}><Heart size={16} className={wished ? 'fill-current' : ''} />{wished ? 'On your wishlist' : 'Add to wishlist'}</button>
        <p className="mt-1 text-center text-[11px] text-slate-500">Your wishlist is private</p>
      </div>
      <div className="min-w-0 space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-1.5"><RoleChip role={p.role} />{p.secondaryRole && <span className="chip bg-ink-600 text-slate-300">{p.secondaryRole}</span>}<span className={`chip ${p.overseas ? 'bg-amber-500/20 text-amber-300' : 'bg-ink-600 text-slate-300'}`}>{p.overseas ? 'Overseas' : 'Indian'}</span><span className="chip bg-ink-600 text-slate-300">{p.active ? 'Active' : 'Former'}</span><StatusChip status={st} /></div>
          <h2 className="display mt-1.5 text-4xl leading-none text-white">{p.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-slate-300"><Flag country={p.nationality} />{p.nationality}{p.fullName && p.fullName !== p.name && <span className="text-slate-500">· {p.fullName}</span>}{p.dob && <span className="text-slate-500">· born {p.dob}</span>}</div>
        </div>
        {sold && own && <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3"><TeamBadge id={own} size={40} /><div><div className="text-sm text-slate-300">{sold.via === 'retention' ? 'Retained by' : 'Sold to'} {teamName(own)}</div><div className="font-display text-2xl font-bold text-emerald-300">{fmt(sold.price)}</div></div></div>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="Arena base price" value={fmt(base)} accent sub={state.baseOverrides[p.id] ? 'Set by host' : 'Rule-based'} />
          <Tile label="Historical base price" value={p.historicalBasePrice ? fmt(p.historicalBasePrice) : '—'} sub={p.historicalBasePrice ? 'Imported record' : 'Not on record'} />
          <Tile label="IPL matches" value={p.matches} sub={`${p.seasons[0]}–${p.seasons[p.seasons.length - 1]}`} />
          <Tile label="Seasons" value={p.seasons.length} />
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <KV k="Batting style" v={p.battingStyle ?? 'Not recorded'} /><KV k="Bowling style" v={p.bowlingStyle ?? 'Not recorded'} />
          <KV k="Batting position" v={p.battingPosition ?? '—'} /><KV k="Bowling type" v={p.bowlingType ?? '—'} />
        </dl>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">IPL career</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {[['Runs', s.runs], ['Avg', stat.avg(p).toFixed(1)], ['SR', stat.sr(p).toFixed(1)], ['HS', s.highScore], ['4s / 6s', `${s.fours}/${s.sixes}`], ['Wkts', s.wickets], ['Econ', s.ballsBowled ? stat.econ(p).toFixed(2) : '–'], ['Overs', s.ballsBowled ? Math.floor(s.ballsBowled / 6) : '–'], ['Catches', s.catches], ['Stumpings', s.stumpings]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-ink-700/70 px-2 py-1.5 text-center"><div className="font-display text-lg font-bold leading-none text-white">{v}</div><div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-400">{k}</div></div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">IPL teams represented</div>
          <div className="flex flex-wrap gap-2">{p.teams.map((t) => <span key={t} className="flex items-center gap-1.5 rounded-lg bg-ink-700/70 py-1 pl-1 pr-2.5 text-xs text-slate-200">{franchise(t) ? <TeamBadge id={t} size={22} /> : <span className="chip bg-ink-500 text-slate-300">{t}</span>}{teamName(t)}</span>)}</div>
          <div className="mt-2 text-xs text-slate-500">Seasons: {p.seasons.join(', ')}</div>
        </div>

        {(isHost || (myTeam && myTeam.r.nominations > 0)) && (
          <div className="space-y-3 rounded-xl border border-ink-500 bg-ink-900/60 p-3">
            {canOpen && (isHost
              ? <button className="btn-gold w-full" onClick={async () => (await act('next', { playerId: p.id })) && onClose()}><Star size={16} />Bring to auction now</button>
              : <button className="btn-gold w-full" onClick={async () => (await act('nominate', { playerId: p.id })) && onClose()}><Star size={16} />Use my nomination on {p.name}</button>)}
            {isHost && (st === 'upcoming' || st === 'unsold') && (
              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-400">Host: set base price for this auction</div>
                <div className="flex flex-wrap gap-1.5">
                  {BASES.map((b) => <button key={b} onClick={() => act('player.setBase', { playerId: p.id, price: b })} className={`rounded-lg border px-2 py-1 text-xs font-semibold ${base === b ? 'border-gold bg-gold/15 text-gold' : 'border-ink-500 text-slate-300 hover:bg-ink-600'}`}>{fmt(b)}</button>)}
                  <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = crToLakh(custom); if (v > 0) act('player.setBase', { playerId: p.id, price: v }).then((ok) => ok && setCustom('')); }}>
                    <input className="!w-28 !py-1 !text-xs" type="number" step="0.05" min="0.05" placeholder="Custom ₹ Cr" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom base price in crore" /><button className="btn-ghost !px-2 !py-1 !text-xs">Set</button>
                  </form>
                </div>
              </div>
            )}
            {isHost && poolSet.has(p.id) && (st === 'upcoming' || st === 'unsold') && <button className="btn-danger !py-1 !text-xs" onClick={() => act('player.withdraw', { playerId: p.id })}>Withdraw from this auction</button>}
            {isHost && st === 'withdrawn' && <button className="btn-ghost !py-1 !text-xs" onClick={() => act('player.withdraw', { playerId: p.id, restore: true })}>Restore to the auction pool</button>}
          </div>
        )}
        <p className="text-[11px] text-slate-500">Career figures computed from Cricsheet ball-by-ball records; styles and role {p.roleSource === 'wikipedia' ? 'from Wikipedia' : 'derived from match records'}.{p.photo ? ' Photo: Wikimedia Commons.' : ''}</p>
      </div>
    </div>
  );
}
const KV = ({ k, v }: { k: string; v: string }) => <div className="flex justify-between gap-3 border-b border-ink-600/60 py-1"><dt className="text-slate-500">{k}</dt><dd className="text-right text-slate-200">{v}</dd></div>;
