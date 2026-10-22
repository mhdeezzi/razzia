// Sonde des cotes historiques ESPN : pour quelques dates de 2025-26, le résumé du match a-t-il encore ses cotes
// (pickcenter), et l'API « core » garde-t-elle les cotes d'ouverture et de clôture ?
//   node src/dev/probeodds.ts
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const get = async (u: string) => { const r = await fetch(u); return r.ok ? r.json() : { _status: r.status }; };
for (const d of ['20251025', '20251120', '20251220', '20260120', '20260320', '20261021']) {
  const sb: any = await get(`${SITE}/scoreboard?dates=${d}`);
  const e = sb.events?.[0];
  if (!e) { console.log(d, 'pas de match', sb._status ?? ''); continue; }
  const sum: any = await get(`${SITE}/summary?event=${e.id}`);
  const pc = sum.pickcenter?.[0];
  const core: any = await get(`${CORE}/events/${e.id}/competitions/${e.id}/odds`);
  const items = core.items ?? [];
  const first: any = items[0]?.$ref ? await get(items[0].$ref.replace('http://', 'https://')) : items[0];
  const ml = first?.homeTeamOdds;
  console.log(`${d} ${e.shortName} | scoreboard odds ${e.competitions?.[0]?.odds?.length ?? 0} | pickcenter ${pc ? `${pc.provider?.name} ML ${pc.homeTeamOdds?.moneyLine}/${pc.awayTeamOdds?.moneyLine} écart ${pc.spread}` : 'absent'} | core ${items.length} fournisseurs${first ? ` ; ${first.provider?.name} : ML dom. ${ml?.moneyLine ?? '?'} ouverture ${JSON.stringify(ml?.open?.moneyLine ?? first?.moneyline?.home?.open ?? null)} clôture ${JSON.stringify(ml?.close?.moneyLine ?? first?.moneyline?.home?.close ?? null)}` : ''}`);
  if (d === '20251120' && first) console.log('  clés :', Object.keys(first).join(', '), '| homeTeamOdds :', Object.keys(first.homeTeamOdds ?? {}).join(', '));
}
