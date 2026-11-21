import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { franchise, fmt, ROLE_LABEL, teamName, type Player, type PlayerStatus, type Role, type TeamState } from '../../../shared/types';

const ISO: Record<string, string> = {
  India: 'in', Australia: 'au', 'South Africa': 'za', 'New Zealand': 'nz', England: 'gb-eng', 'Sri Lanka': 'lk', Pakistan: 'pk',
  Bangladesh: 'bd', Afghanistan: 'af', Zimbabwe: 'zw', 'United States': 'us', Ireland: 'ie', Netherlands: 'nl', Singapore: 'sg',
  'United Arab Emirates': 'ae', Nepal: 'np', Canada: 'ca', Kenya: 'ke', Scotland: 'gb-sct', Namibia: 'na', Oman: 'om', 'Hong Kong': 'hk',
};

export function Flag({ country, className = '' }: { country: string; className?: string }) {
  const [bad, setBad] = useState(false);
  const iso = ISO[country];
  if (!iso || bad) return <span className={`chip bg-ink-600 text-slate-300 !px-1 ${className}`}>{country === 'West Indies' ? 'WI' : country.slice(0, 3).toUpperCase()}</span>;
  return <img src={`https://flagcdn.com/w40/${iso}.png`} alt={country} title={country} loading="lazy" onError={() => setBad(true)} className={`inline-block h-3.5 w-5 rounded-[3px] object-cover ring-1 ring-black/40 ${className}`} />;
}

/** Franchise crest: our own monogram badge in team colours (official logos are trademarks, so we don't ship them). */
export function TeamBadge({ id, size = 40, ring = false }: { id: string; size?: number; ring?: boolean }) {
  const f = franchise(id);
  return (
    <span title={teamName(id)} className={`inline-flex shrink-0 items-center justify-center rounded-xl font-display font-extrabold tracking-wide ${ring ? 'ring-2 ring-white/70' : ''}`}
      style={{ width: size, height: size, fontSize: size * (id.length > 3 ? 0.3 : 0.38), color: f?.text ?? '#fff', background: f ? `linear-gradient(140deg, ${f.color} 55%, ${f.color2} 56%)` : '#27345c', textShadow: f?.text === '#fff' ? '0 1px 2px rgba(0,0,0,.6)' : 'none' }}>
      {id}
    </span>
  );
}

const ROLE_STYLE: Record<Role, string> = { BAT: 'bg-sky-500/15 text-sky-300', WK: 'bg-violet-500/15 text-violet-300', AR: 'bg-emerald-500/15 text-emerald-300', BOWL: 'bg-rose-500/15 text-rose-300' };
const ROLE_GRAD: Record<Role, string> = { BAT: 'from-sky-600 to-indigo-900', WK: 'from-violet-600 to-fuchsia-900', AR: 'from-emerald-600 to-teal-900', BOWL: 'from-rose-600 to-red-950' };
export const RoleChip = ({ role }: { role: Role }) => <span className={`chip ${ROLE_STYLE[role]}`}>{ROLE_LABEL[role]}</span>;

export function Avatar({ p, className = '' }: { p: Player; className?: string }) {
  const [bad, setBad] = useState(false);
  const initials = p.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${ROLE_GRAD[p.role]} ${className}`}>
      <span className="absolute inset-0 flex items-center justify-center font-display font-bold text-white/85" style={{ fontSize: '2.2em' }}>{initials}</span>
      {p.photo && !bad && <img src={p.photo} alt={p.name} loading="lazy" onError={() => setBad(true)} className="absolute inset-0 h-full w-full object-cover object-top" />}
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  upcoming: 'bg-slate-500/15 text-slate-300', bidding: 'bg-gold/20 text-gold', sold: 'bg-emerald-500/15 text-emerald-300',
  unsold: 'bg-red-500/15 text-red-300', withdrawn: 'bg-zinc-500/20 text-zinc-400', 'not in pool': 'bg-zinc-500/10 text-zinc-500',
};
export const StatusChip = ({ status }: { status: PlayerStatus | 'not in pool' }) => <span className={`chip ${STATUS_STYLE[status]}`}>{status === 'bidding' ? 'Bidding now' : status}</span>;

export function PurseBar({ team, compact = false }: { team: TeamState; compact?: boolean }) {
  const pct = Math.max(0, Math.min(100, (team.purse / Math.max(1, team.initialPurse)) * 100));
  const f = franchise(team.id);
  return (
    <div>
      {!compact && <div className="mb-1 flex justify-between text-[11px] text-slate-400"><span>Spent {fmt(team.initialPurse - team.purse)}</span><span>of {fmt(team.initialPurse)}</span></div>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600">
        <motion.div className="h-full rounded-full" style={{ background: pct < 15 ? '#ef4444' : f?.color === '#1B2A4A' ? f.color2 : f?.color ?? '#f5b942' }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} />
      </div>
    </div>
  );
}

export function Modal({ open, onClose, children, wide = false, title }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; title?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div role="dialog" aria-modal="true" aria-label={title} className={`card max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`} initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-600 bg-ink-800/95 px-5 py-3 backdrop-blur">
              <h3 className="h-section !text-lg">{title}</h3>
              <button aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-600 hover:text-white"><X size={18} /></button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export const Tile = ({ label, value, sub, accent = false }: { label: string; value: ReactNode; sub?: ReactNode; accent?: boolean }) => (
  <div className="rounded-xl border border-ink-600 bg-ink-700/60 px-3 py-2.5">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
    <div className={`font-display text-2xl font-bold leading-tight ${accent ? 'text-gold' : 'text-white'}`}>{value}</div>
    {sub && <div className="truncate text-[11px] text-slate-400">{sub}</div>}
  </div>
);

export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <div className="flex flex-col gap-1"><label>{label}</label>{children}{hint && <span className="text-[11px] text-slate-500">{hint}</span>}</div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-xl border border-dashed border-ink-500 px-4 py-8 text-center text-sm text-slate-400">{children}</div>;

/** Money input in crore (e.g. 12.5) → lakhs. */
export const crToLakh = (v: string) => Math.round(parseFloat(v) * 100);
export const lakhToCr = (l: number) => String(l / 100);
