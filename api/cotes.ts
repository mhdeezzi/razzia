// Comparateur de cotes : bookmakers français (Betclic, Unibet, Winamax, Parions Sport, NetBet, PMU) contre la référence
// Pinnacle sans marge (le marché le plus juste), via The Odds API.
//   GET /api/cotes  -> { games: [{ home, away, start, ref?, books: [...] }] }
// Variable Vercel : ODDS_API_KEY (clé gratuite sur the-odds-api.com). Réponse gardée 10 minutes en cache pour
// économiser les crédits (une requête = 3 crédits : vainqueur, écart, total).
const KEY = (process.env.ODDS_API_KEY ?? '').trim();
const BOOKS = ['pinnacle', 'betclic_fr', 'unibet_fr', 'winamax_fr', 'parionssport_fr', 'netbet_fr', 'pmu_fr'];

interface Price {
  home?: number;
  away?: number;
  spread?: { point: number; home: number; away: number }; // point : écart pour l'équipe à domicile
  total?: { point: number; over: number; under: number };
}

const noVig = (a: number, b: number): [number, number] => {
  const pa = 1 / a;
  const pb = 1 / b;
  return [pa / (pa + pb), pb / (pa + pb)];
};

export async function GET(): Promise<Response> {
  if (!KEY)
    return Response.json(
      { error: 'Clé ODDS_API_KEY absente : créer une clé gratuite sur the-odds-api.com, puis dans Vercel : Settings, Environment Variables, ajouter ODDS_API_KEY et redéployer.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${encodeURIComponent(KEY)}&bookmakers=${BOOKS.join(',')}&markets=h2h,spreads,totals&oddsFormat=decimal`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return Response.json({ error: `The Odds API ${r.status}` }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    const data = (await r.json()) as any[];
    const games = data.map((e) => {
      const books = (e.bookmakers ?? []).map((b: any) => {
        const p: Price = {};
        for (const m of b.markets ?? []) {
          const o = (name: string) => m.outcomes?.find((x: any) => x.name === name);
          if (m.key === 'h2h') {
            p.home = o(e.home_team)?.price;
            p.away = o(e.away_team)?.price;
          } else if (m.key === 'spreads' && o(e.home_team) && o(e.away_team)) {
            p.spread = { point: o(e.home_team).point, home: o(e.home_team).price, away: o(e.away_team).price };
          } else if (m.key === 'totals' && o('Over') && o('Under')) {
            p.total = { point: o('Over').point, over: o('Over').price, under: o('Under').price };
          }
        }
        return { key: b.key as string, title: b.title as string, updated: b.last_update as string, ...p };
      });
      const pin = books.find((b: any) => b.key === 'pinnacle');
      const ref = pin?.home && pin?.away ? { home: noVig(pin.home, pin.away)[0], away: noVig(pin.home, pin.away)[1] } : undefined;
      return { home: e.home_team as string, away: e.away_team as string, start: e.commence_time as string, ref, books };
    });
    const left = r.headers.get('x-requests-remaining');
    return Response.json({ games, creditsLeft: left ? Number(left) : undefined, at: new Date().toISOString() }, { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
