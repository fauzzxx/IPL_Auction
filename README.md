# IPL Auction Arena

A real-time multiplayer IPL mega-auction game. Friends join a room, pick franchises, receive identical purses
and bid live for every player who has appeared in the IPL since 2008. A Challenge Arena with two wheels
applies real budget, squad and bidding effects.

## Run it

Requires Node.js 20+.

```bash
npm install
```

```bash
npm run setup
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:4000. Share `http://<your-ip>:4000/room/<CODE>` with friends on the same network,
or deploy it (below) to play over the internet.

For development with hot reload: `npm run dev` (client on :5173, server on :4000).
Tip: append `?as=2` to a room URL to act as a second player in the same browser.

## Tests

```bash
npm test
```

Boots a real server and drives it with four socket clients. The 59 checks cover: duplicate franchises,
host-only actions, forged tokens, purse deduction, overspend and mandatory-slot reserve, simultaneous bids,
double-sale prevention, unsold, undo, countdown, pause, budget/release/skip challenges, the two wheels,
reconnection, the database ledger reconciling with every purse, removing participants, and host handover.

## How it works

| Part | Where |
|---|---|
| Authoritative auction engine (all rules, timers, challenges, RTM, retention, undo) | `server/src/engine.ts` |
| HTTP API + Socket.IO realtime | `server/src/index.ts` |
| Database layer (Prisma) — atomic transactions for sales, releases, challenges | `server/src/db.ts`, `server/prisma/schema.prisma` |
| Formats, default rules, default challenge deck | `server/src/defaults.ts` |
| Shared types and money helpers (all money in lakhs) | `shared/types.ts` |
| React client (Vite, Tailwind, Framer Motion, Lucide) | `client/src` |

Clients only send intents ("bid ₹2.5 Cr", "spin"). The server validates every action and broadcasts one shared state,
so nobody can edit their purse or a player's status from the browser. Rooms are snapshotted to the database and
restored after a restart (a live lot comes back paused). If the host disconnects for 45 s, the host seat passes to
another connected participant.

## Challenge Arena

Wheel 1 picks a team, wheel 2 picks that team's challenge, and the server applies the effect immediately.
Settings → Challenge Arena controls how often and who spins:

- **A challenge every N players sold** (default 5; 0 = only when the host spins).
- **Who spins**: *Automatic* (default: when a challenge is due, the next player waits while the server spins both
  wheels for everyone), *Host spins*, or *Teams take turns* (franchises spin in order, one turn per due challenge).
- The host can always spin. Pressing Spin while a player is on the block queues the challenge for right after that player.

## Player database

`server/data/players.json` is built by `server/scripts/build_players.py` from open data — nothing is invented:

- **Cricsheet** ball-by-ball IPL archive: every player, teams, seasons, appearances, career stats (runs, average,
  strike rate, wickets, economy, catches, stumpings), batting position.
- **Wikidata**: canonical name, nationality, date of birth, Wikimedia Commons photo.
- **Wikipedia** infobox: batting style, bowling style, playing role.
- `server/data/overrides.json`: manual nationality fixes for players the automatic join missed.

Re-run `python server/scripts/build_players.py` after a new season, then delete `server/arena.db` so the server reseeds.

**Base prices.** The *arena base price* is a transparent rule on IPL appearances (₹30 L for under 5 matches, up to
₹2 Cr for 150+). It is **not** a historical auction price. The `historicalBasePrice` field is empty until you import
verified figures. Hosts can set any player's base price per auction (presets ₹30 L–₹2 Cr, or custom).

**Importing data** (CSV or JSON), matched by `id` or exact `name`; only the supplied columns are updated:

```bash
npm run import-players --prefix server -- prices.csv
```

```csv
name,historicalBasePrice
Virat Kohli,200
```

New players need at least `name`, `role` (BAT/WK/AR/BOWL) and `nationality`. Restart the server afterwards.

## Deploying (Vercel + a live game server)

This app is a real-time auction: 7–8 phones stay connected, bid at the same time, share purses and
challenge wheels. That needs **one always-on Node process** with Socket.IO. Vercel is a static/serverless
host, so it can serve the website but **cannot** run the auction engine. If you import this repo into
Vercel alone, rooms, bidding and the wheels will not work.

The working setup:

1. **Game server** (Render, Railway, Fly.io, or any VPS) — Node + SQLite, a **single instance**.
2. **Website** (Vercel) — the React UI, talking to that server.

### 1. Push this folder to GitHub

The GitHub repo root should be this `ipl-auction-arena` folder (the one with `package.json` and `vercel.json`).

### 2. Deploy the game server first (Render)

1. Create a Web Service from this repo (Blueprint: `render.yaml`, or connect the repo and set):
   - Build: `npm install && npm run setup && npm run build`
   - Start: `npm start`
   - Instance count: **1** (do not autoscale — every device must hit the same process)
2. Environment:
   - `DATABASE_URL=file:./arena.db`
   - `CLIENT_ORIGINS=https://YOUR-APP.vercel.app` (add after step 3; until then any origin is allowed)
3. Copy the public URL, e.g. `https://ipl-auction-arena.onrender.com`. Open `/api/health` — you should see `"ok": true`.

Railway / Fly / a VPS: same commands. `PORT` is provided by the host. Bind address is `0.0.0.0`.

Free Render services sleep after idle time. Wake them before a session, or use a paid always-on instance so
the first friend to open the site is not waiting on a cold start.

### 3. Deploy the UI on Vercel

1. Import the same GitHub repo.
2. Vercel reads `vercel.json` (framework: Other, output `client/dist`).
3. **Environment variable (Production)** — required, then Redeploy:
   - `VITE_SERVER_URL` = the game-server URL from step 2, **no trailing slash**
     (`https://ipl-auction-arena.onrender.com`)
4. After the Vercel URL exists, set `CLIENT_ORIGINS` on the game server to that URL and restart it.

Friends open the **Vercel** link. Invite copies `https://your-app.vercel.app/room/CODE`. All 7–8 devices
talk to the same game server over WebSocket (with HTTP long-polling as fallback).

### One-box (no Vercel)

On Render/Railway/Fly you can skip Vercel: the Node process also serves `client/dist`. Share that host’s URL.
Do not put this process on Vercel.

### PostgreSQL (optional)

Change `provider = "sqlite"` to `"postgresql"` in `server/prisma/schema.prisma`, set `DATABASE_URL` to a
managed database, and run `npm run db --prefix server`. SQLite on a single instance is enough for a friend
auction. Do not run multiple server replicas — room state lives in memory on one process.

## Notes

- Team crests are our own monogram badges in team colours. Official logos are trademarks and are not shipped.
- Fan-made and unofficial; not affiliated with the BCCI, the IPL or any franchise.
