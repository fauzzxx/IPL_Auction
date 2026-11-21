import { BarChart3, BookOpen, Check, Copy, Gavel, History, Settings as Cog, Shield, Sparkles, Trophy, Users, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fmt } from '../../../shared/types';
import Arena from '../components/Arena';
import Auction from '../components/Auction';
import Catalogue, { PlayerModal } from '../components/Catalogue';
import { HistoryTab, Results, Stats } from '../components/Insights';
import Lobby from '../components/Lobby';
import SettingsPanel from '../components/SettingsPanel';
import Teams from '../components/Teams';
import { Field, TeamBadge } from '../components/ui';
import { api, getSession, go, PlayerModalCtx, RoomProvider, saveName, savedName, setSession, usePlayers, useRoom, useToast, type Session } from '../store';
import { Logo } from './Landing';


export default function Room({ code }: { code: string }) {
  const toast = useToast();
  const [session, setSess] = useState<Session | null>(getSession(code));
  const [info, setInfo] = useState<{ name: string; host: string; phase: string; teams: string[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState(savedName());

  useEffect(() => { api(`/rooms/${code}`).then(setInfo).catch(() => setMissing(true)); }, [code]);

  if (missing) return (
    <Center><h1 className="display text-4xl text-white">Room not found</h1><p className="text-slate-400">The code <b>{code}</b> does not match an active auction room.</p><button className="btn-gold" onClick={() => go('/')}>Back to home</button></Center>
  );

  if (!session) {
    const join = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        const r = await api(`/rooms/${code}/join`, { name });
        saveName(name.trim());
        const s = { participantId: r.participantId, token: r.token };
        setSession(code, s); setSess(s);
      } catch (err: any) { toast(err.message); }
    };
    return (
      <Center>
        <Logo />
        <form onSubmit={join} className="card w-full max-w-sm space-y-4 p-6 text-left">
          <div><div className="text-xs uppercase tracking-wider text-slate-400">You are joining</div><div className="display text-2xl text-white">{info?.name ?? '…'}</div>
            {info && <div className="text-sm text-slate-400">Hosted by {info.host} · {info.teams.length} franchise{info.teams.length === 1 ? '' : 's'} taken · {info.phase}</div>}</div>
          <Field label="Your display name"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="e.g. Priya" /></Field>
          <button className="btn-gold w-full !py-3">Enter the auction room</button>
        </form>
      </Center>
    );
  }

  return (
    <RoomProvider code={code} session={session} fallback={<Center><div className="h-10 w-10 animate-spin rounded-full border-2 border-gold border-t-transparent" /><p className="text-slate-400">Connecting to room {code}…</p></Center>}
      onLost={(why) => { setSession(code, null); setSess(null); toast(why); }}>
      <Shell />
    </RoomProvider>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">{children}</div>;

type Tab = 'main' | 'catalogue' | 'arena' | 'teams' | 'stats' | 'history' | 'settings';

function Shell() {
  const { state, connected, myTeam, isHost } = useRoom();
  const { loading } = usePlayers();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('main');
  const [player, setPlayer] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setTab('main'); }, [state.phase]);
  useEffect(() => { document.title = `${state.name} · IPL Auction Arena`; }, [state.name]);

  const share = async () => {
    const url = `${location.origin}/room/${state.code}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); toast('Invite link copied', 'good'); } catch { toast(url, 'info'); }
  };

  const mainLabel = { lobby: 'Lobby', retention: 'Retention', auction: 'Auction', ended: 'Results' }[state.phase];
  const tabs: { id: Tab; label: string; icon: any; show?: boolean; dot?: boolean }[] = [
    { id: 'main', label: mainLabel, icon: state.phase === 'ended' ? Trophy : Gavel },
    { id: 'catalogue', label: 'Players', icon: BookOpen },
    { id: 'arena', label: 'Challenge Arena', icon: Sparkles, show: state.settings.challengesEnabled, dot: !!state.run || state.challengeDue },
    { id: 'teams', label: 'Teams', icon: Shield },
    { id: 'stats', label: 'Stats', icon: BarChart3, show: state.phase !== 'lobby' },
    { id: 'history', label: 'History', icon: History, show: state.phase !== 'lobby' },
    { id: 'settings', label: 'Settings', icon: Cog },
  ];

  if (loading) return <Center><div className="h-10 w-10 animate-spin rounded-full border-2 border-gold border-t-transparent" /><p className="text-slate-400">Loading the player database…</p></Center>;

  return (
    <PlayerModalCtx.Provider value={setPlayer}>
      <div className="mx-auto flex min-h-screen max-w-[1500px] flex-col px-3 sm:px-5">
        <header className="no-print flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
          <button onClick={() => go('/')} aria-label="Home"><Logo small /></button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{state.name}</div>
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className={`inline-flex items-center gap-1 ${connected ? 'text-emerald-400' : 'text-red-400'}`}>{connected ? <Wifi size={12} /> : <WifiOff size={12} />}{connected ? 'Live' : 'Reconnecting'}</span>
              <span className="inline-flex items-center gap-1"><Users size={12} />{state.participants.filter((p) => p.connected).length} online</span>
              {isHost && <span className="chip bg-gold/15 !py-0 text-gold">Host</span>}
            </div>
          </div>
          <button onClick={share} className="btn-ghost !px-3 !py-1.5" title="Copy invite link">
            <span className="font-display text-base tracking-[.25em] text-gold">{state.code}</span>{copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
          </button>
          {myTeam && (
            <div className="flex items-center gap-2 rounded-xl border border-ink-500 bg-ink-800 px-2.5 py-1.5">
              <TeamBadge id={myTeam.id} size={30} />
              <div className="leading-tight"><div className="text-[10px] uppercase tracking-wider text-slate-400">Purse</div><div className="font-display text-lg font-bold text-white">{fmt(myTeam.purse)}</div></div>
            </div>
          )}
        </header>

        <nav className="no-print -mx-3 mb-4 flex gap-1 overflow-x-auto border-b border-ink-600 px-3 sm:mx-0 sm:px-0" aria-label="Sections">
          {tabs.filter((t) => t.show !== false).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id}
              className={`relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${tab === t.id ? 'border-gold text-gold' : 'border-transparent text-slate-400 hover:text-white'}`}>
              <t.icon size={16} />{t.label}{t.dot && <span className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-gold pulse-ring" />}
            </button>
          ))}
        </nav>

        <main className="flex-1 pb-10">
          {tab === 'main' && (state.phase === 'lobby' ? <Lobby onSettings={() => setTab('settings')} /> : state.phase === 'ended' ? <Results /> : <Auction goArena={() => setTab('arena')} goCatalogue={() => setTab('catalogue')} />)}
          {tab === 'catalogue' && <Catalogue />}
          {tab === 'arena' && <Arena />}
          {tab === 'teams' && <Teams />}
          {tab === 'stats' && <Stats />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'settings' && <SettingsPanel />}
        </main>
      </div>
      <PlayerModal id={player} onClose={() => setPlayer(null)} />
    </PlayerModalCtx.Provider>
  );
}
