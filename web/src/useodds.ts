import { useEffect, useState } from 'react';
import type { Sport } from '../../src/live/flashscore.ts';
import type { OddsGame, OddsTarget } from '../../src/odds/prices.ts';
import { readPrices, withinPriceHorizon } from './oddsdata.ts';

/** Après la fin de chaque appel, sans chevauchement ; en pause quand l'onglet est masqué. */
export function usePrices(sport: Sport, targets: OddsTarget[], interval = 15_000): Map<string, OddsGame> {
  const wanted = targets.filter((t) => withinPriceHorizon(t));
  const key = JSON.stringify(wanted);
  const [data, setData] = useState<{ key: string; games: Map<string, OddsGame> }>({ key: '', games: new Map() });
  useEffect(() => {
    let stopped = false, busy = false, timer: number | undefined;
    const matches = JSON.parse(key) as OddsTarget[];
    const poll = async () => {
      window.clearTimeout(timer);
      if (stopped || busy || document.visibilityState === 'hidden' || !matches.length) return;
      busy = true;
      try {
        const games = await readPrices(sport, matches);
        if (!stopped) setData({ key, games });
      } catch {
        if (!stopped) setData({ key, games: new Map() }); // Le fournisseur existant reprend la main.
      } finally {
        busy = false;
        if (!stopped) timer = window.setTimeout(poll, interval);
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') void poll(); else window.clearTimeout(timer); };
    void poll();
    document.addEventListener('visibilitychange', visible);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [sport, key, interval]);
  return data.key === key ? data.games : new Map();
}
