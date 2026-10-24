// Sonde tennis n° 4 : tous les fichiers proposés par TennisMyLife, et la Wikidata (photos des joueurs).
//   node src/dev/probetennis4.ts
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' };
const page = await (await fetch('https://stats.tennismylife.org/tennis-match-database', { headers: UA })).text();
const links = [...new Set([...page.matchAll(/https?:\/\/stats\.tennismylife\.org\/data\/[^"' )]+/g)].map((m) => m[0]))];
console.log(`${links.length} fichiers :`, links.join(' '));
for (const u of links.filter((l) => /chall|futures|qual/i.test(l)).slice(0, 6)) {
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15_000) });
  const t = await r.text(), lines = t.trim().split('\n'), H = lines[0].split(','), di = H.indexOf('tourney_date');
  const d = lines.slice(1).map((l) => l.split(',')[di]).sort();
  console.log(`${r.status} ${lines.length - 1} lignes ${d[0]} -> ${d.at(-1)}  ${u}`);
}
const wd = await fetch('https://www.wikidata.org/wiki/Special:EntityData/Q72091.json', { headers: UA, signal: AbortSignal.timeout(15_000) });
const j: any = wd.ok ? await wd.json() : undefined;
const ent: any = j ? Object.values(j.entities)[0] : undefined;
console.log('Wikidata', wd.status, ent?.labels?.en?.value, ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value);
const fp = await fetch(`https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(ent?.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? '')}?width=300`, { headers: UA, redirect: 'manual' });
console.log('Commons', fp.status, fp.headers.get('location'));
