import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { MeState, Player, PlayerStatus, RoomState, TeamState } from '../../shared/types';

/** Empty locally (Vite proxies /api and /socket.io). On Vercel, set VITE_SERVER_URL to the game server origin. */
export const SERVER_URL = String(import.meta.env.VITE_SERVER_URL ?? '').replace(/\/$/, '');

// ---- session (guest identity per room, kept in localStorage so a refresh or reconnect keeps your seat) ----
export interface Session { participantId: string; token: string }
// `?as=2` gives a separate identity slot — handy for trying several players in one browser.
const slot = new URLSearchParams(location.search).get('as') ?? '';
const key = (code: string) => `arena:${code.toUpperCase()}:${slot}`;
export const getSession = (code: string): Session | null => { try { return JSON.parse(localStorage.getItem(key(code)) ?? 'null'); } catch { return null; } };
export const setSession = (code: string, s: Session | null) => { try { s ? localStorage.setItem(key(code), JSON.stringify(s)) : localStorage.removeItem(key(code)); } catch { /* private mode */ } };
export const savedName = () => { try { return localStorage.getItem('arena:name') ?? ''; } catch { return ''; } };
export const saveName = (n: string) => { try { localStorage.setItem('arena:name', n); } catch { /* ignore */ } };

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}/api${path}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? 'Request failed');
  return json;
}

export const go = (path: string) => { history.pushState(null, '', path + (slot ? `?as=${slot}` : '')); window.dispatchEvent(new PopStateEvent('popstate')); };

// ---- toasts ----
interface Toast { id: number; text: string; kind: 'error' | 'info' | 'good' }
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'error') => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { id, text, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none no-print">
        {list.map((t) => (
          <div key={t.id} role="status" className={`px-4 py-2.5 rounded-xl text-sm font-medium shadow-card border backdrop-blur ${t.kind === 'error' ? 'bg-red-950/90 border-red-500/50 text-red-100' : t.kind === 'good' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-100' : 'bg-ink-700/95 border-ink-500 text-slate-100'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---- player database (fetched once, served from our own server) ----
interface PlayersCtx { list: Player[]; map: Map<string, Player>; latestSeason: number; loading: boolean; error: string | null }
const PCtx = createContext<PlayersCtx>({ list: [], map: new Map(), latestSeason: 0, loading: true, error: null });
export const usePlayers = () => useContext(PCtx);
export function PlayersProvider({ children }: { children: ReactNode }) {
  const [v, setV] = useState<PlayersCtx>({ list: [], map: new Map(), latestSeason: 0, loading: true, error: null });
  useEffect(() => {
    api<{ players: Player[]; latestSeason: number }>('/players')
      .then((d) => setV({ list: d.players, map: new Map(d.players.map((p) => [p.id, p])), latestSeason: d.latestSeason, loading: false, error: null }))
      .catch((e: Error) => setV((x) => ({ ...x, loading: false, error: e.message || 'Could not reach the auction server' })));
  }, []);
  return <PCtx.Provider value={v}>{children}</PCtx.Provider>;
}

// ---- live room ----
export interface RoomCtx {
  state: RoomState;
  pool: string[];
  poolSet: Set<string>;
  me: MeState;
  myTeam: TeamState | null;
  isHost: boolean;
  connected: boolean;
  session: Session;
  offset: number; // serverNow - Date.now()
  owner: Map<string, string>; // playerId -> franchise id
  statusOf: (playerId: string) => PlayerStatus | 'not in pool';
  act: (type: string, payload?: unknown) => Promise<boolean>;
}
const RCtx = createContext<RoomCtx | null>(null);
export const useRoom = () => useContext(RCtx)!;

export function RoomProvider({ code, session, onLost, children, fallback }: { code: string; session: Session; onLost: (why: string) => void; children: ReactNode; fallback: ReactNode }) {
  const toast = useToast();
  const [state, setState] = useState<RoomState | null>(null);
  const [pool, setPool] = useState<string[]>([]);
  const [me, setMe] = useState<MeState>({ participantId: session.participantId, wishlist: [] });
  const [connected, setConnected] = useState(false);
  const [offset, setOffset] = useState(0);
  const sock = useRef<Socket | null>(null);

  useEffect(() => {
    const s = io(SERVER_URL || undefined, {
      auth: { code, participantId: session.participantId, token: session.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 4000,
      timeout: 20000,
    });
    sock.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (e) => { if (/expired|not found|Unauthorized/i.test(e.message)) onLost(e.message); });
    s.on('state', (st: RoomState) => { setOffset(st.serverNow - Date.now()); setState(st); });
    s.on('pool', setPool);
    s.on('me', setMe);
    s.on('kicked', () => onLost('You were removed from the room by the host'));
    return () => { s.close(); };
  }, [code, session.participantId, session.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback((type: string, payload?: unknown) => new Promise<boolean>((resolve) => {
    const s = sock.current;
    if (!s?.connected) { toast('Not connected — reconnecting…'); return resolve(false); }
    s.timeout(8000).emit('action', type, payload ?? {}, (err: unknown, r?: { ok: boolean; error?: string }) => {
      if (err || !r?.ok) toast(r?.error ?? 'No response from the server');
      resolve(!!r?.ok);
    });
  }), [toast]);

  const value = useMemo<RoomCtx | null>(() => {
    if (!state) return null;
    const mine = state.participants.find((p) => p.id === session.participantId);
    const owner = new Map<string, string>();
    for (const t of Object.values(state.teams)) for (const e of t.squad) owner.set(e.playerId, t.id);
    const poolSet = new Set(pool);
    return {
      state, pool, poolSet, me, connected, session, offset, owner, act,
      myTeam: (mine?.teamId && state.teams[mine.teamId]) || null,
      isHost: state.hostId === session.participantId,
      statusOf: (id) => state.status[id] ?? (poolSet.has(id) ? 'upcoming' : 'not in pool'),
    };
  }, [state, pool, me, connected, offset, act, session]);

  if (!value) return <>{fallback}</>;
  return <RCtx.Provider value={value}>{children}</RCtx.Provider>;
}

/** Re-renders every `ms` and returns the server-corrected clock. */
export function useNow(ms = 250) {
  const { offset } = useRoom();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), ms); return () => clearInterval(i); }, [ms]);
  return Date.now() + offset;
}

// ---- player profile modal (opened from anywhere in a room) ----
export const PlayerModalCtx = createContext<(id: string) => void>(() => {});
export const useOpenPlayer = () => useContext(PlayerModalCtx);
