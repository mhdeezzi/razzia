// MODÈLE DE SOURCE (non branché) : copier ce fichier, remplir les deux fonctions avec les appels du fournisseur choisi,
// puis l'ajouter à SOURCES dans src/live/source.ts. Exemple écrit pour un fournisseur tennis type « API-Tennis » ; les
// adresses et noms de champs sont à adapter à la documentation du fournisseur retenu.
import { getJson } from '../feeds.ts';
import type { LiveSource, RawPoint, RawStat, SourceMatch, SourceRef } from '../source.ts';

const KEY = () => (process.env.TENNIS_SOURCE_KEY ?? '').trim(); // clé dans les variables Vercel, jamais dans le code
const BASE = 'https://fournisseur.example/api'; // à remplacer

export const modele: LiveSource = {
  name: 'modele',
  sports: ['tennis'],
  ready: () => KEY() !== '',
  async live(): Promise<SourceRef[]> {
    const d = await getJson<any>(`${BASE}/live?key=${encodeURIComponent(KEY())}`, 5_000);
    return (d.matches ?? []).map((m: any) => ({ id: String(m.id), sport: 'tennis' as const, home: m.player1, away: m.player2, tourney: m.tournament }));
  },
  async match(_sport, id): Promise<SourceMatch> {
    const d = await getJson<any>(`${BASE}/match/${encodeURIComponent(id)}?key=${encodeURIComponent(KEY())}`, 3_000);
    // Stats : libellés et valeurs tels que le fournisseur les donne (« Unforced Errors », « 64% (32/50) »…).
    const stats: RawStat[] = (d.statistics ?? []).map((s: any) => ({ label: s.name, home: s.home, away: s.away, period: s.period ?? 'ALL' }));
    // Points : serveur, vainqueur, et la description de fin de point telle quelle (« Backhand unforced error »…).
    const pointLog: RawPoint[] = (d.points ?? []).map((p: any) => ({
      server: p.server === 'first' ? 0 : 1, winner: p.winner === 'first' ? 0 : 1, set: p.set, serve: p.serve,
      result: p.result, stroke: p.shot, rally: p.rally, breakPoint: p.break_point,
    }));
    return { id, sport: 'tennis', home: d.player1, away: d.player2, state: d.finished ? 'post' : 'in', tennis: { bestOf: d.best_of, pointLog }, stats };
  },
};
