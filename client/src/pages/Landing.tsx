import { motion } from 'framer-motion';
import { ArrowRight, Gavel, Radio, Sparkles, Users, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FRANCHISES, type AuctionFormat, type Settings } from '../../../shared/types';
import { Field, TeamBadge } from '../components/ui';
import { api, go, saveName, savedName, setSession, usePlayers, useToast } from '../store';

interface FormatInfo { id: AuctionFormat; description: string; settings: Settings; poolSize: number }
const FORMAT_NAME: Record<AuctionFormat, string> = { mega: 'Standard Mega Auction', mini: 'Mini Auction', legends: 'Legends Auction', alltime: 'All-Time IPL Auction', custom: 'Custom Auction' };

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-gold-soft to-gold-deep text-ink-950 ${small ? 'h-8 w-8' : 'h-11 w-11'}`}><Gavel size={small ? 17 : 24} strokeWidth={2.5} /></span>
      <span className={`display leading-none text-white ${small ? 'text-lg' : 'text-2xl'}`}>Auction <span className="text-gold">Arena</span></span>
    </span>
  );
}

export default function Landing() {
  const toast = useToast();
  const { list, loading, error } = usePlayers();
  const [formats, setFormats] = useState<FormatInfo[]>([]);
  const [name, setName] = useState(savedName());
  const [roomName, setRoomName] = useState('');
  const [format, setFormat] = useState<AuctionFormat>('mega');
  const [teams, setTeams] = useState(10);
  const [purse, setPurse] = useState('120');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<FormatInfo[]>('/formats').then(setFormats).catch(() => {}); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast('Enter your display name');
    setBusy(true);
    try {
      const r = await api('/rooms', { name: roomName, hostName: name, settings: { format, maxTeams: teams, purse: Math.round(parseFloat(purse) * 100) || 12000 } });
      saveName(name.trim());
      setSession(r.code, { participantId: r.participantId, token: r.token });
      go(`/room/${r.code}`);
    } catch (err: any) { toast(err.message); } finally { setBusy(false); }
  };

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/.*\/room\//i, '').slice(0, 8);
    if (!c) return toast('Enter a room code');
    try {
      await api(`/rooms/${c}`);
      if (name.trim()) { // rejoining with your name drops you straight back into your seat
        const r = await api(`/rooms/${c}/join`, { name });
        saveName(name.trim());
        setSession(r.code, { participantId: r.participantId, token: r.token });
      }
      go(`/room/${c}`);
    } catch (err: any) { toast(err.message); }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <header className="flex items-center justify-between py-5"><Logo /><span className="hidden text-xs text-slate-400 sm:block">{list.length ? `${list.length} IPL players · 2008 – today` : loading ? 'Connecting…' : ''}</span></header>
      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/70 px-4 py-3 text-sm text-red-100">
          Cannot reach the auction server. On Vercel, set <code className="text-gold">VITE_SERVER_URL</code> to your Render/Railway game-server URL and redeploy. Locally, start the server with <code className="text-gold">npm start</code>.
        </div>
      )}

      <section className="grid items-center gap-10 py-6 lg:grid-cols-[1.1fr_1fr] lg:py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <span className="chip mb-4 bg-gold/15 text-gold"><Radio size={12} /> Live multiplayer auction</span>
          <h1 className="display text-5xl leading-[.95] text-white sm:text-7xl">Host your own<br /><span className="bg-gradient-to-r from-gold-soft via-gold to-orange-400 bg-clip-text text-transparent">IPL Mega Auction</span></h1>
          <p className="mt-5 max-w-xl text-base text-slate-300">Pick a franchise, get ₹120 crore, and out-bid your friends in real time for every player in IPL history. Then spin the Challenge Arena wheels and watch plans fall apart.</p>
          <div className="mt-6 flex flex-wrap gap-2">{FRANCHISES.map((f) => <TeamBadge key={f.id} id={f.id} size={38} />)}</div>
          <ul className="mt-7 grid max-w-xl grid-cols-2 gap-3 text-sm text-slate-300">
            {[[Users, '2–10 teams per room'], [Wallet, 'Server-enforced purse rules'], [Gavel, 'Live bidding with countdown'], [Sparkles, 'Challenge wheels with real effects']].map(([I, t]: any) => (
              <li key={t} className="flex items-center gap-2"><I size={16} className="text-gold" />{t}</li>
            ))}
          </ul>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-4">
          <form onSubmit={create} className="card space-y-4 p-5">
            <h2 className="h-section">Create an auction room</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="e.g. Rahul" /></Field>
              <Field label="Room name"><input value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} placeholder="Friday Night Auction" /></Field>
            </div>
            <Field label="Auction format">
              <div className="grid gap-2">
                {(formats.length ? formats : [{ id: 'mega', description: '', poolSize: 0 } as FormatInfo]).map((f) => (
                  <button type="button" key={f.id} onClick={() => setFormat(f.id)} aria-pressed={format === f.id}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left transition ${format === f.id ? 'border-gold/70 bg-gold/10' : 'border-ink-500 bg-ink-800 hover:border-ink-500/60 hover:bg-ink-700'}`}>
                    <span><span className="block text-sm font-semibold text-white">{FORMAT_NAME[f.id]}</span><span className="block text-xs text-slate-400">{f.description}</span></span>
                    {f.poolSize > 0 && <span className="chip shrink-0 bg-ink-600 text-slate-300">{f.poolSize} players</span>}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Number of teams"><select value={teams} onChange={(e) => setTeams(+e.target.value)}>{[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n}>{n}</option>)}</select></Field>
              <Field label="Starting purse (₹ crore)"><input type="number" min={5} max={1000} step="1" value={purse} onChange={(e) => setPurse(e.target.value)} /></Field>
            </div>
            <button className="btn-gold w-full !py-3 text-base" disabled={busy}>Create room <ArrowRight size={18} /></button>
            <p className="text-center text-xs text-slate-500">Squad sizes, timer, RTM, retention and challenges are configurable inside the room.</p>
          </form>

          <form onSubmit={join} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
            <div className="flex-1"><Field label="Have a room code?"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 2GT6RQ" className="font-display !text-lg uppercase tracking-[.3em]" /></Field></div>
            <button className="btn-ghost !py-2.5">Join room</button>
          </form>
        </motion.div>
      </section>
      <footer className="mt-8 border-t border-ink-600 pt-5 text-xs text-slate-500">
        Fan-made and unofficial. Not affiliated with the BCCI, the IPL or any franchise. Player records from Cricsheet, Wikidata and Wikipedia.
      </footer>
    </div>
  );
}
