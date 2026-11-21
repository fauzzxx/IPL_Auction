import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/types';
import { useRoom } from '../store';
import { Field } from './ui';

const FORMATS = [['mega', 'Standard Mega Auction'], ['mini', 'Mini Auction'], ['legends', 'Legends Auction'], ['alltime', 'All-Time IPL Auction'], ['custom', 'Custom Auction']];

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="card p-5"><h3 className="h-section mb-3 !text-base">{title}</h3><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div></section>
);

export default function SettingsPanel() {
  const { state, act, isHost, pool } = useRoom();
  const [d, setD] = useState<Settings>(state.settings);
  const [name, setName] = useState(state.name);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) { setD(state.settings); setName(state.name); } }, [state.settings, state.name, dirty]);

  const lobby = state.phase === 'lobby';
  const ro = !isHost;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setD((x) => ({ ...x, [k]: v })); setDirty(true); };
  const num = (k: keyof Settings, opts: { cr?: boolean; frozen?: boolean; min?: number; max?: number; step?: number } = {}) => (
    <input type="number" disabled={ro || (opts.frozen && !lobby)} min={opts.min} max={opts.max} step={opts.step ?? (opts.cr ? 0.5 : 1)}
      value={opts.cr ? (d[k] as number) / 100 : (d[k] as number)} onChange={(e) => set(k, (opts.cr ? Math.round(+e.target.value * 100) : +e.target.value) as any)} />
  );
  const check = (k: keyof Settings, label: string, frozen = false) => (
    <label className="flex cursor-pointer items-center gap-2 !text-sm !text-slate-200"><input type="checkbox" disabled={ro || (frozen && !lobby)} checked={d[k] as boolean} onChange={(e) => set(k, e.target.checked as any)} />{label}</label>
  );
  const save = async () => { if (await act('settings.update', { settings: d, name })) setDirty(false); };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {!isHost && <p className="rounded-xl border border-ink-500 bg-ink-800 px-4 py-2.5 text-sm text-slate-300">Only the host can change the room settings. You are viewing them read-only.</p>}
      {isHost && !lobby && <p className="rounded-xl border border-gold/30 bg-gold/5 px-4 py-2.5 text-sm text-slate-300">The auction is under way: purse, format, team count and retention rules are locked. Pacing and challenge options can still be changed.</p>}

      <Section title="Room & format">
        <Field label="Room name"><input disabled={ro || !lobby} value={name} maxLength={40} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
        <Field label="Auction format" hint={`${pool.length} players in the pool`}><select disabled={ro || !lobby} value={d.format} onChange={(e) => set('format', e.target.value as any)}>{FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Number of teams (2–10)">{num('maxTeams', { frozen: true, min: 2, max: 10 })}</Field>
        {d.format === 'custom' && <>
          <Field label="Pool: minimum IPL matches">{num('poolMinMatches', { frozen: true, min: 0 })}</Field>
          <Field label="Pool: player status"><select disabled={ro || !lobby} value={d.poolStatus} onChange={(e) => set('poolStatus', e.target.value as any)}><option value="all">All players</option><option value="active">Active only</option><option value="former">Former only</option></select></Field>
        </>}
      </Section>

      <Section title="Purse & squads">
        <Field label="Starting purse (₹ crore)" hint="Identical for every team">{num('purse', { cr: true, frozen: true, min: 5 })}</Field>
        <Field label="Minimum squad size" hint="Funds are reserved for unfilled slots">{num('minSquad', { min: 1, max: 30 })}</Field>
        <Field label="Maximum squad size">{num('maxSquad', { min: 1, max: 40 })}</Field>
        <Field label="Maximum overseas players">{num('maxOverseas', { min: 0 })}</Field>
      </Section>

      <Section title="Bidding">
        <Field label="Bid increments (₹ lakh, comma separated)" hint="The smallest is the minimum raise">
          <input disabled={ro} defaultValue={d.increments.join(', ')} key={state.settings.increments.join()} onChange={(e) => set('increments', e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => n > 0))} />
        </Field>
        <Field label="Countdown per player (seconds)" hint="0 = no clock, host closes manually">{num('timerSec', { min: 0, max: 300 })}</Field>
        <Field label="Anti-snipe reset (seconds)" hint="A late bid resets the clock to this. 0 = off">{num('antiSnipeSec', { min: 0, max: 60 })}</Field>
        <Field label="Nomination order"><select disabled={ro} value={d.nominationOrder} onChange={(e) => set('nominationOrder', e.target.value as any)}>
          <option value="marquee">Marquee first (most IPL appearances)</option><option value="sets">Sets (base price, then role)</option><option value="random">Random</option><option value="manual">Manual — host nominates</option></select></Field>
        <div className="flex flex-col justify-end gap-2">{check('autoNext', 'Bring the next player automatically')}{check('reauctionUnsold', 'Allow re-auction of unsold players')}</div>
      </Section>

      <Section title="Challenge Arena">
        <div className="flex flex-col gap-2">{check('challengesEnabled', 'Enable challenges')}{check('challengeRepeat', 'Challenges can repeat')}</div>
        <Field label="Who spins the wheels" hint="The host can always spin as well"><select disabled={ro} value={d.spinBy} onChange={(e) => set('spinBy', e.target.value as any)}>
          <option value="auto">Automatic — server spins when a challenge is due</option><option value="host">Host spins</option><option value="rotation">Teams take turns</option></select></Field>
        <Field label="A challenge every N players sold" hint="0 = only when the host spins">{num('challengeEvery', { min: 0, max: 50 })}</Field>
        <Field label="Selected team…"><select disabled={ro} value={d.challengeMode} onChange={(e) => set('challengeMode', e.target.value as any)}><option value="mandatory">must accept (mandatory)</option><option value="optional">may accept or reject</option></select></Field>
        <Field label="Refund when a player is released (%)">{num('releaseRefundPct', { min: 0, max: 100, step: 5 })}</Field>
      </Section>

      <Section title="Retention & Right to Match (optional)">
        <div className="flex flex-col gap-2">{check('retentionEnabled', 'Retention window before the auction', true)}{check('rtmEnabled', 'Right to Match cards')}</div>
        <Field label="Max retentions per team">{num('maxRetentions', { frozen: true, min: 0, max: 10 })}</Field>
        <Field label="Retention cost per slot (₹ crore)" hint="1st, 2nd, 3rd… retention">
          <input disabled={ro || !lobby} defaultValue={d.retentionCosts.map((c) => c / 100).join(', ')} key={state.settings.retentionCosts.join()} onChange={(e) => set('retentionCosts', e.target.value.split(',').map((x) => Math.round(parseFloat(x) * 100)).filter((n) => n >= 0))} />
        </Field>
        <Field label="RTM cards per team">{num('rtmCards', { frozen: true, min: 0, max: 5 })}</Field>
        <Field label="RTM decision window (seconds)">{num('rtmWindowSec', { min: 5, max: 60 })}</Field>
        <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-1">Teams may retain, or use RTM on, players who have actually played for their franchise in the IPL.</p>
      </Section>

      {isHost && <div className="sticky bottom-3 flex justify-end"><button className="btn-gold shadow-card" disabled={!dirty} onClick={save}><Save size={16} />Save settings</button></div>}
    </div>
  );
}
