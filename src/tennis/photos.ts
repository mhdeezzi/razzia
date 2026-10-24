// Photos des joueurs : la photo officielle ATP (de face, fond uni), chargée par le navigateur d'après le code ATP du
// joueur ; à défaut, l'image Wikidata (P18) de sa page Wikipédia, en vignette Wikimedia Commons, gardée en cache
// (photos.json) : une recherche par joueur.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UA = { 'User-Agent': 'razzia/1.0 (analyse tennis ; usage privé)' };
const get = async (url: string) => {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000) });
    return r.ok ? await r.json() : undefined;
  } catch {
    return undefined;
  }
};

/** Photo officielle ATP d'après le code du joueur (« S0AG » pour Jannik Sinner). */
export const atpHeadshot = (code: string) => `https://www.atptour.com/-/media/alias/player-headshot/${code.toLowerCase()}`;

/** Vignette Wikipédia du joueur (300 px) ou undefined. Cherche « Nom (tennis) » puis « Nom ». */
export async function photoOf(name: string, cacheDir: string, cacheFile = 'photos.json'): Promise<string | undefined> {
  const file = join(cacheDir, cacheFile);
  const cache: Record<string, string | null> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (name in cache) return cache[name] ?? undefined;
  let url: string | undefined;
  for (const title of [`${name} (tennis)`, name]) {
    const j = await get(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages|pageprops&pithumbsize=300&redirects=1&format=json`);
    const page: any = j ? Object.values(j.query?.pages ?? {})[0] : undefined;
    // Seulement une page de joueur de tennis (Wikidata : sport = tennis, Q847), pas un homonyme.
    const qid = page?.pageprops?.wikibase_item;
    if (!page?.thumbnail?.source || !qid) continue;
    const wd = await get(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    const claims = wd?.entities?.[qid]?.claims ?? {};
    const sports = (claims.P641 ?? []).map((c: any) => c.mainsnak?.datavalue?.value?.id);
    if (!sports.includes('Q847')) continue;
    url = page.thumbnail.source;
    break;
  }
  cache[name] = url ?? null;
  writeFileSync(file, JSON.stringify(cache));
  return url;
}
