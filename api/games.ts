// Programme des prochains jours (ESPN) : horaires, bilans, cotes DraftKings, blessés par équipe.
//   GET /api/games?days=7            (à partir d'aujourd'hui)
//   GET /api/games?days=1&from=AAAA-MM-JJ  (un jour passé : scores finaux, pour le suivi des paris)
//   GET /api/games?box=<id ESPN>     (feuille de match : points et minutes de chaque joueur, pour les paris joueurs)
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
// Tricodes ESPN -> NBA (le moteur utilise ceux de la NBA).
const TRI: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };
const tri = (a: string) => TRI[a] ?? a;

/** Date (AAAA-MM-JJ) à New York : les matchs NBA sont datés à l'heure de l'Est. */
const etDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const num = (v: unknown) => (v === 'EVEN' ? 100 : v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

async function json(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`ESPN ${r.status}`);
  return r.json();
}

/** Feuille de match ESPN : état du match et, pour chaque joueur, points, minutes, et s'il n'a pas joué. */
async function box(id: string): Promise<Response> {
  try {
    const j = await json(`${SITE}/summary?event=${encodeURIComponent(id)}`);
    const players = (j.boxscore?.players ?? []).flatMap((t: any) =>
      (t.statistics ?? []).flatMap((st: any) => {
        const keys: string[] = st.keys ?? [];
        const iPts = keys.indexOf('points'), iMin = keys.indexOf('minutes');
        return (st.athletes ?? []).map((a: any) => ({
          name: a.athlete?.displayName ?? '',
          pts: iPts >= 0 ? num(a.stats?.[iPts]) ?? 0 : 0,
          min: iMin >= 0 ? num(a.stats?.[iMin]) ?? 0 : 0,
          dnp: !!a.didNotPlay || !(a.stats ?? []).length,
        }));
      }),
    );
    const state = j.header?.competitions?.[0]?.status?.type?.state ?? 'pre';
    return Response.json({ id, state, players }, { headers: { 'Cache-Control': `public, s-maxage=${state === 'post' ? 3600 : 60}, stale-while-revalidate=300` } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const boxId = new URL(request.url).searchParams.get('box');
  if (boxId && /^\d+$/.test(boxId)) return box(boxId);
  const days = Math.min(10, Math.max(1, Number(new URL(request.url).searchParams.get('days') ?? 7) || 7));
  const from = new URL(request.url).searchParams.get('from');
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T16:00:00Z`) : new Date();
  const dates = Array.from({ length: days }, (_, i) => etDate(new Date(start.getTime() + i * 864e5)));
  try {
    // Une requête par jour : ESPN refuse les plages de dates (400).
    const [days, inj] = await Promise.all([
      Promise.all(dates.map((d) => json(`${SITE}/scoreboard?dates=${d.replaceAll('-', '')}`))),
      json(`${SITE}/injuries`).catch(() => ({ injuries: [] })),
    ]);
    const events = days.flatMap((b) => b.events ?? []).filter((e: any, i: number, all: any[]) => all.findIndex((x) => x.id === e.id) === i);
    const nameToTri = new Map<string, string>();
    const games = events.map((e: any) => {
      const c = e.competitions?.[0] ?? {};
      const side = (ha: 'home' | 'away') => {
        const t = c.competitors?.find((x: any) => x.homeAway === ha) ?? {};
        const code = tri(t.team?.abbreviation ?? '');
        nameToTri.set(t.team?.displayName ?? '', code);
        return {
          tri: code,
          city: t.team?.location ?? '',
          name: t.team?.name ?? t.team?.shortDisplayName ?? '',
          color: t.team?.color ? `#${t.team.color}` : undefined,
          logo: t.team?.logo,
          record: t.records?.find((r: any) => r.type === 'total')?.summary ?? t.records?.[0]?.summary,
          homeAwayRecord: t.records?.find((r: any) => r.type === (ha === 'home' ? 'home' : 'road'))?.summary,
          score: num(t.score),
        };
      };
      const o = c.odds?.[0];
      return {
        id: String(e.id),
        date: etDate(new Date(e.date)),
        start: e.date,
        state: e.status?.type?.state ?? 'pre', // pre | in | post
        detail: e.status?.type?.shortDetail ?? '',
        seasonType: e.season?.type ?? 2,
        note: c.notes?.[0]?.headline,
        venue: c.venue?.fullName,
        city: c.venue?.address?.city,
        tv: (c.broadcasts ?? []).flatMap((b: any) => b.names ?? []).slice(0, 3),
        home: side('home'),
        away: side('away'),
        odds: o
          ? {
              provider: o.provider?.name,
              spreadHome: num(o.spread),
              total: num(o.overUnder),
              mlHome: num(o.moneyline?.home?.close?.odds ?? o.homeTeamOdds?.moneyLine),
              mlAway: num(o.moneyline?.away?.close?.odds ?? o.awayTeamOdds?.moneyLine),
              spreadOddsHome: num(o.pointSpread?.home?.close?.odds ?? o.homeTeamOdds?.spreadOdds),
              spreadOddsAway: num(o.pointSpread?.away?.close?.odds ?? o.awayTeamOdds?.spreadOdds),
              overOdds: num(o.total?.over?.close?.odds ?? o.overOdds),
              underOdds: num(o.total?.under?.close?.odds ?? o.underOdds),
            }
          : undefined,
      };
    });
    const injuries: Record<string, Array<{ name: string; status: string; detail: string }>> = {};
    for (const t of inj.injuries ?? []) {
      const code = nameToTri.get(t.displayName);
      if (!code) continue;
      injuries[code] = (t.injuries ?? []).map((i: any) => ({ name: i.athlete?.displayName ?? '', status: i.status ?? '', detail: i.shortComment ?? '' }));
    }
    return Response.json(
      { generatedAt: new Date().toISOString(), dates, games, injuries },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
