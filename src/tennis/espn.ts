// Calendrier ATP d'ESPN (simple messieurs) : matchs programmés du jour à dans 6 jours (et de la veille), avec tous les
// identifiants ESPN vus pour chaque match (une même rencontre peut porter un identifiant différent selon la requête).
// Qualifications et joueurs inconnus (TBD) ignorés.

export const nameKey = (n: string) => (n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
export const pairKey = (a: string, b: string) => [nameKey(a), nameKey(b)].sort().join('|');
/** Même joueur malgré une orthographe plus longue d'un côté (« Daniel Merida » / « Daniel Merida Aguilar »). */
export const samePlayer = (a: string, b: string) => { const x = nameKey(a), y = nameKey(b); return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `); };
export const samePair = (m: { home: string; away: string }, n: { home: string; away: string }) =>
  (samePlayer(m.home, n.home) && samePlayer(m.away, n.away)) || (samePlayer(m.home, n.away) && samePlayer(m.away, n.home));

/** Tour ESPN -> code des fiches Pinnacle (« ATP Paris - R16 ») ; undefined : qualifications. */
export function roundCode(name = ''): string | undefined {
  if (/qualif/i.test(name)) return undefined;
  if (/semi/i.test(name)) return 'SF';
  if (/quarter/i.test(name)) return 'QF';
  if (/^final/i.test(name)) return 'F';
  const of = name.match(/round of (\d+)/i);
  if (of) return `R${of[1]}`;
  const n = name.match(/round (\d)/i);
  return n ? `R${n[1]}` : '';
}

export interface Fixture { id: string; ids: string[]; event: string; round: string; start: string; home: string; away: string; state: string }

/** Matchs ESPN par paire de joueurs ; `ids` : tous les identifiants vus pour la paire. */
export async function espnFixtures(): Promise<Map<string, Fixture>> {
  const out = new Map<string, Fixture>();
  const ymd = (i: number) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
  for (const q of ['', ...[-1, 1, 2, 3, 4, 5, 6].map((i) => `?dates=${ymd(i)}`)]) {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard${q}`, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
    if (!r?.ok) { console.log(`ESPN ${q || 'du jour'} : indisponible`); continue; }
    for (const ev of (await r.json()).events ?? [])
      for (const g of ev.groupings ?? []) {
        if (g.grouping?.slug !== 'mens-singles') continue;
        for (const c of g.competitions ?? []) {
          const ps = (c.competitors ?? []).filter((p: any) => p.athlete?.displayName && p.athlete.displayName !== 'TBD');
          const round = roundCode(c.round?.displayName), start = c.startDate ?? c.date;
          if (ps.length !== 2 || round === undefined || !/^\d{5,14}$/.test(String(c.id)) || !start || Number.isNaN(Date.parse(start))) continue;
          const pk = pairKey(ps[0].athlete.displayName, ps[1].athlete.displayName);
          const prev = out.get(pk);
          const ids = [...new Set([...(prev?.ids ?? []), String(c.id)])];
          out.set(pk, { id: prev?.id ?? String(c.id), ids, event: ev.shortName ?? ev.name ?? '', round, start: new Date(start).toISOString(), home: ps[0].athlete.displayName, away: ps[1].athlete.displayName, state: c.status?.type?.state ?? 'pre' });
        }
      }
  }
  return out;
}

/** Nom de tournoi façon Pinnacle (« ATP Paris ») : repris d'une fiche cotée où joue l'un des deux joueurs, sinon le nom ESPN. */
export function leagueOf(f: Fixture, priced: Array<{ league: string; home: string; away: string; start: string }>): string {
  const twin = priced.find((m) => [nameKey(m.home), nameKey(m.away)].some((k) => k === nameKey(f.home) || k === nameKey(f.away)) && Math.abs(Date.parse(m.start) - Date.parse(f.start)) < 7 * 86_400_000);
  return `${twin ? String(twin.league).split(' - ')[0] : `ATP ${f.event}`}${f.round ? ` - ${f.round}` : ''}`;
}
