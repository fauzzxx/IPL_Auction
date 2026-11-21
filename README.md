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

## Deploying on Vercel

This is a **single Container** app (the root `Dockerfile`). It serves the website, `/api` and Socket.IO
from one process. Root Directory must be `./`. Application Preset must be **Container**, not Services.

Do not import `client` or `server` as separate projects.

1. Import `fauzzxx/IPL_Auction`.
2. Root Directory: **IPL_Auction (root)**.
3. Application Preset: **Container**.
4. Leave environment variables empty and deploy.

After deploy, open `/api/health`. Then share `https://your-app.vercel.app/room/CODE`.

### Render / Railway (optional, instead of Vercel)

One Node process: `npm install && npm run setup && npm run build`, then `npm start`. Instance count: 1.

### PostgreSQL (optional)

Change `provider = "sqlite"` to `"postgresql"` in `server/prisma/schema.prisma`, set `DATABASE_URL` to a
managed database, and run `npm run db --prefix server`. SQLite on a single instance is enough for a friend
auction.

## Notes

- Team crests are our own monogram badges in team colours. Official logos are trademarks and are not shipped.
- Fan-made and unofficial; not affiliated with the BCCI, the IPL or any franchise.
