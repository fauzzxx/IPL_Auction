import { motion } from 'framer-motion';
import { Crown, Play, Shuffle, UserMinus } from 'lucide-react';
import { fmt, FRANCHISES } from '../../../shared/types';
import { useRoom } from '../store';
import { TeamBadge } from './ui';

export default function Lobby({ onSettings }: { onSettings: () => void }) {
  const { state, act, isHost, session, pool } = useRoom();
  const s = state.settings;
  const me = state.participants.find((p) => p.id === session.participantId)!;
  const taken = Object.keys(state.teams).length;
  const full = taken >= s.maxTeams;
  const ownerOf = (id: string) => state.participants.find((p) => p.teamId === id);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="h-section">Choose your franchise</h2><p className="text-sm text-slate-400">{taken} of {s.maxTeams} team slots taken · every team starts with <b className="text-gold">{fmt(s.purse)}</b></p></div>
          {isHost && <button className="btn-ghost" onClick={() => act('team.randomize')}><Shuffle size={16} />Randomise franchises</button>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {FRANCHISES.map((f, i) => {
            const owner = ownerOf(f.id);
            const mine = me.teamId === f.id;
            const locked = (!!owner && !mine) || (!owner && full && !me.teamId);
            return (
              <motion.button key={f.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} disabled={locked}
                onClick={() => act(mine ? 'team.leave' : 'team.select', { teamId: f.id })} aria-pressed={mine}
                className={`card group relative overflow-hidden p-4 text-left transition ${mine ? '!border-gold ring-2 ring-gold/40' : owner ? 'opacity-60' : 'hover:-translate-y-0.5 hover:!border-slate-400'}`}>
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${f.color}, ${f.color2})` }} />
                <TeamBadge id={f.id} size={52} />
                <div className="mt-3 font-display text-lg font-bold leading-tight text-white">{f.name}</div>
                <div className={`mt-1 text-xs font-medium ${mine ? 'text-gold' : owner ? 'text-slate-300' : 'text-emerald-400'}`}>
                  {mine ? 'Your franchise · tap to leave' : owner ? `Taken by ${owner.name}` : full && !me.teamId ? 'Team limit reached' : 'Available'}
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <h3 className="h-section !text-base">Participants</h3>
          <ul className="mt-2 space-y-1.5">
            {state.participants.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-lg bg-ink-700/60 px-2.5 py-1.5 text-sm">
                <span className={`h-2 w-2 rounded-full ${p.connected ? 'bg-emerald-400' : 'bg-slate-600'}`} title={p.connected ? 'Online' : 'Offline'} />
                <span className="flex-1 truncate text-white">{p.name}{p.id === me.id && <span className="text-slate-500"> (you)</span>}</span>
                {p.isHost && <Crown size={14} className="text-gold" aria-label="Host" />}
                {p.teamId ? <TeamBadge id={p.teamId} size={24} /> : <span className="text-[11px] text-slate-500">no team</span>}
                {isHost && p.id !== me.id && <button aria-label={`Remove ${p.name}`} title="Remove from room" onClick={() => confirm(`Remove ${p.name} from the room?`) && act('kick', { participantId: p.id })} className="rounded p-1 text-slate-500 hover:bg-red-500/20 hover:text-red-300"><UserMinus size={14} /></button>}
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-4 text-sm">
          <div className="flex items-center justify-between"><h3 className="h-section !text-base">Auction rules</h3><button className="text-xs font-semibold text-gold hover:underline" onClick={onSettings}>{isHost ? 'Edit' : 'View all'}</button></div>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-slate-300">
            {[['Format', s.format], ['Player pool', `${pool.length} players`], ['Purse', fmt(s.purse)], ['Squad size', `${s.minSquad}–${s.maxSquad}`], ['Overseas max', s.maxOverseas], ['Bid timer', s.timerSec ? `${s.timerSec}s` : 'Manual'],
              ['Challenges', s.challengesEnabled ? 'On' : 'Off'], ['Retention', s.retentionEnabled ? `Up to ${s.maxRetentions}` : 'Off'], ['RTM cards', s.rtmEnabled ? s.rtmCards : 'Off'], ['Order', s.nominationOrder]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-2 border-b border-ink-600/60 pb-1"><dt className="text-slate-500">{k}</dt><dd className="font-medium capitalize text-white">{v}</dd></div>
            ))}
          </dl>
        </div>

        {isHost ? (
          <button className="btn-gold w-full !py-3.5 text-base" disabled={taken < 2} onClick={() => act('start')}><Play size={18} />{taken < 2 ? 'Need at least 2 teams' : s.retentionEnabled ? 'Open retention window' : 'Start the auction'}</button>
        ) : (
          <div className="card p-4 text-center text-sm text-slate-300">{me.teamId ? 'You are in. Waiting for the host to start the auction…' : 'Pick a franchise, or stay as a spectator.'}</div>
        )}
      </aside>
    </div>
  );
}
