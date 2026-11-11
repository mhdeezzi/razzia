// API de lecture Flashscore, séparée des identifiants et des moteurs FotMob/ESPN existants.
import { Flashscore, SourceError, SPORTS, type Sport } from './flashscore.ts';

export function flashscoreApi(client = new Flashscore({ oddsLocale: 'fr' })) {
  return async (request: Request): Promise<Response> => {
    const params = new URL(request.url).searchParams;
    const sport = params.get('sport'), id = params.get('id'), withOdds = params.get('odds');
    const headers = { 'Cache-Control': 'no-store' };
    if ((sport != null && !SPORTS.includes(sport as Sport)) || (id != null && (!sport || !/^[a-zA-Z0-9]{8}$/.test(id))) || (withOdds != null && !['0', '1'].includes(withOdds)) || (withOdds === '1' && !id)) {
      return Response.json({ error: 'Utiliser sport=foot|tennis|nba et un identifiant Flashscore de 8 caractères ; odds=1 ajoute les cotes à une fiche.' }, { status: 400, headers });
    }
    try {
      if (id && sport) {
        const board = await client.board(sport as Sport);
        const match = board.matches.find((m) => m.id === id);
        if (!match) return Response.json({ error: board.stale ? 'Tableau Flashscore indisponible : présence du match non vérifiable.' : 'Match absent du tableau Flashscore du jour.' }, {
          status: board.stale ? 503 : 404,
          headers: { ...headers, ...(client.retryAfterMs() ? { 'Retry-After': String(Math.ceil(client.retryAfterMs() / 1000)) } : {}) },
        });
        const detail = await client.detail(match, board, { odds: withOdds === '1' });
        const retry = client.retryAfterMs();
        const status = Object.keys(detail.feeds).length ? 200 : retry ? 503 : 502;
        return Response.json(detail, { status, headers: { ...headers, ...(retry ? { 'Retry-After': String(Math.ceil(retry / 1000)) } : {}) } });
      }
      const sports = sport ? [sport as Sport] : SPORTS;
      const boards: Record<string, unknown> = {}, errors: Record<string, string> = {};
      await Promise.all(sports.map(async (s) => {
        try {
          const board = await client.board(s);
          boards[s] = { ...board, matches: board.matches.filter((m) => m.state === 'in') };
          if (board.stale) errors[s] = board.staleReason ?? 'Dernier tableau connu, source indisponible';
        } catch (e) { errors[s] = e instanceof Error ? e.message : 'Source indisponible'; }
      }));
      const retry = client.retryAfterMs();
      return Response.json({ source: 'flashscore', at: new Date().toISOString(), complete: !Object.keys(errors).length, boards, errors }, {
        status: Object.keys(boards).length ? 200 : retry ? 503 : 502,
        headers: { ...headers, ...(retry ? { 'Retry-After': String(Math.ceil(retry / 1000)) } : {}) },
      });
    } catch (e) {
      const retry = client.retryAfterMs();
      return Response.json({ error: e instanceof Error ? e.message : 'Flashscore indisponible' }, {
        status: retry || (e instanceof SourceError && [401, 403, 429].includes(e.status)) ? 503 : 502,
        headers: { ...headers, ...(retry ? { 'Retry-After': String(Math.ceil(retry / 1000)) } : {}) },
      });
    }
  };
}

export const GET = flashscoreApi();
