// Import or update players from a JSON or CSV file:  npm run import-players -- path/to/file.(json|csv)
//
// JSON: an array of player objects (or { "players": [...] }) in the shape of data/players.json.
// CSV : a header row, then one player per line. Recognised columns:
//       id,name,shortName,nationality,role(BAT|WK|AR|BOWL),battingStyle,bowlingStyle,teams(pipe separated),
//       matches,basePrice(lakhs),historicalBasePrice(lakhs),photo
// Rows are matched to existing players by id, then by exact name; only the supplied columns are updated,
// so a two-column CSV (name,historicalBasePrice) is enough to load verified historical base prices.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Player } from '../../shared/types.js';
import { ensureCategories, playerRow, prisma } from './db.js';

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift()?.map((h) => h.trim()) ?? [];
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Math.round(Number(v)));

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: npm run import-players -- <file.json|file.csv>');
  const text = readFileSync(file, 'utf8');
  const raw: any[] = file.toLowerCase().endsWith('.csv') ? parseCsv(text) : (() => { const j = JSON.parse(text); return Array.isArray(j) ? j : j.players; })();
  await ensureCategories();
  let created = 0, updated = 0, skipped = 0;
  for (const r of raw) {
    const existing = (r.id && (await prisma.player.findUnique({ where: { id: String(r.id) } }))) || (r.name && (await prisma.player.findFirst({ where: { name: String(r.name) } })));
    const teams = Array.isArray(r.teams) ? r.teams : r.teams ? String(r.teams).split('|').map((x) => x.trim()).filter(Boolean) : undefined;
    if (existing) {
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'shortName', 'fullName', 'nationality', 'battingStyle', 'bowlingStyle', 'bowlingType', 'battingPosition', 'secondaryRole', 'photo']) if (r[k]) patch[k] = String(r[k]);
      if (r.role && ['BAT', 'WK', 'AR', 'BOWL'].includes(r.role)) patch.role = r.role;
      if (r.nationality) patch.overseas = r.nationality !== 'India';
      if (teams) patch.teams = teams.join(',');
      for (const k of ['matches', 'basePrice', 'historicalBasePrice']) if (num(r[k]) !== undefined) patch[k] = num(r[k]);
      await prisma.player.update({ where: { id: existing.id }, data: patch });
      updated++;
    } else if (r.name && ['BAT', 'WK', 'AR', 'BOWL'].includes(r.role) && r.nationality) {
      const p = {
        id: String(r.id || randomUUID().slice(0, 8)), name: r.name, shortName: r.shortName || r.name, fullName: r.fullName || null,
        nationality: r.nationality, overseas: r.nationality !== 'India', role: r.role, secondaryRole: r.secondaryRole || null, roleSource: 'import',
        battingStyle: r.battingStyle || null, bowlingStyle: r.bowlingStyle || null, bowlingType: r.bowlingType || null, battingPosition: r.battingPosition || null,
        teams: teams ?? [], seasons: Array.isArray(r.seasons) ? r.seasons : [], matches: num(r.matches) ?? 0, active: r.active === true || r.active === 'true',
        lastSeason: num(r.lastSeason) ?? 0, basePrice: num(r.basePrice) ?? 30, historicalBasePrice: num(r.historicalBasePrice) ?? null,
        photo: r.photo || null, dob: r.dob || null, wikipedia: r.wikipedia || null,
        stats: r.stats ?? { runs: 0, balls: 0, outs: 0, highScore: 0, fours: 0, sixes: 0, wickets: 0, ballsBowled: 0, runsConceded: 0, catches: 0, stumpings: 0 },
      } as Player;
      await prisma.$transaction([prisma.player.create({ data: playerRow(p) }), prisma.playerStatistics.create({ data: { playerId: p.id, ...p.stats } })]);
      created++;
    } else skipped++;
  }
  console.log(`import complete: ${created} created, ${updated} updated, ${skipped} skipped (new players need name, role and nationality). Restart the server to load changes.`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
