// Ce que Razzia affichera en foot, et le prono mis en avant.
//
// Affichage : Premier League, LaLiga, Ligue 1, Ligue des Champions ; la Serie A seulement quand un grand club joue
// (Juventus, Inter, Milan, Napoli, Roma, Atalanta, Como) ; pas de Bundesliga. Les autres championnats restent dans les données
// (forces des clubs croisés en Ligue des Champions) mais ne sont jamais affichés.
//
// Prono mis en avant : la double chance du favori (ou sa victoire à domicile). Un combiné ne la remplace que s'il est
// vraiment sûr ET qu'il rapporte vraiment plus : au moins 3 points au-dessus du seuil de sûreté, et au moins 6 points de
// probabilité en moins que la double chance seule (sinon la cote ne bouge presque pas : « + moins de 5,5 buts » ajouté à
// une double chance ne change quasiment rien). Rien si même la double chance n'atteint pas le seuil (match trop ouvert).
// Écartés après contrôle sur 2024-2026 car moins sûrs qu'annoncé : victoire du favori à l'extérieur, victoire ou double
// chance + plus de 1,5 but.

export const BIG_ITALY = new Set([9885, 8636, 8564, 9875, 8686, 8524, 10171]); // Juventus, Inter, Milan, Napoli, Roma, Atalanta, Como
export const SHOWN_LEAGUES = new Set([47, 87, 53, 42, 55]);

export function shown(m: { lg: number; home: { id: number }; away: { id: number } }): boolean {
  if (!SHOWN_LEAGUES.has(m.lg)) return false;
  if (m.lg === 55) return BIG_ITALY.has(m.home.id) || BIG_ITALY.has(m.away.id);
  return true;
}

export const COMBO_MARGIN = 0.03;
export const COMBO_GAIN = 0.06;

export function featured(p: Map<string, number>, T: number): { id: string; p: number } | undefined {
  const fav = p.get('1')! >= p.get('2')! ? '1X' : 'X2';
  const dc = p.get(fav)!;
  const base = [...(fav === '1X' ? [{ id: '1', p: p.get('1')! }] : []), { id: fav, p: dc }].filter((c) => c.p >= T);
  const combos = [`${fav}+o0.5`, `${fav}+u4.5`, `${fav}+u5.5`, `${fav}+o0.5+u5.5`]
    .map((id) => ({ id, p: p.get(id)! }))
    .filter((c) => c.p >= T + COMBO_MARGIN && dc - c.p >= COMBO_GAIN);
  return [...base, ...combos].sort((a, b) => a.p - b.p)[0];
}

/** Combiné rattaché à chaque match (toujours affiché, catégorie « Combiné ») : le plus intéressant qui reste au-dessus du
 * seuil de sûreté, en partant de la double chance du favori (sans « + plus de 1,5 but » : 82 % réels pour 85,5 % annoncés
 * sur 2024-2026). « + moins de 5,5 buts » ne sert qu'en dernier recours (il ne
 * change presque rien à la cote). Si aucun n'atteint le seuil, le plus sûr, marqué risqué. */
export function combo(p: Map<string, number>, T: number): { id: string; p: number; risky: boolean } {
  const fav = p.get('1')! >= p.get('2')! ? '1X' : 'X2';
  const main = [`${fav}+o0.5`, `${fav}+u3.5`, `${fav}+u4.5`, `${fav}+o0.5+u4.5`].map((id) => ({ id, p: p.get(id)! }));
  const last = [`${fav}+o0.5+u5.5`, `${fav}+u5.5`].map((id) => ({ id, p: p.get(id)! }));
  const ok = main.filter((c) => c.p >= T).sort((a, b) => a.p - b.p)[0] ?? last.filter((c) => c.p >= T).sort((a, b) => a.p - b.p)[0];
  if (ok) return { ...ok, risky: false };
  const safest = [...main, ...last].sort((a, b) => b.p - a.p)[0];
  return { ...safest, risky: true };
}

/** Bilan Razzia foot (comme basket et tennis) : seuls les pronos non risqués comptent — le prono mis en avant, et le
 * combiné rattaché quand il est jugé sûr. Un combiné « Risqué » n'entre jamais dans le bilan. */
export const countsInBilan = (pick: { risky?: boolean } | undefined) => !!pick && !pick.risky;

/** Niveau d'un match (pastille), à partir des probabilités Razzia (pas de la cote) : le favori est celui de Razzia, même
 * si le marché voit l'autre équipe devant. Vert « assuré » : prono mis en avant à 85 % et plus (91,8 % réussis sur
 * 2024-2026) ; normal : prono mis en avant sous 85 % ; orange « risqué » : pas de prono mis en avant mais double chance
 * du favori à 70 % ou plus (combiné rattaché ~71 %) ; rouge « pile ou face » : double chance du favori sous 70 %
 * (combiné rattaché 52 à 65 %). Seuls vert et normal comptent au bilan. */
export const T_SURE_FOOT = 0.85;
export const T_FLIP_FOOT = 0.7;
export function tier(p: Map<string, number>, best: { p: number } | undefined): 'sure' | 'normal' | 'risky' | 'flip' {
  if (best) return best.p >= T_SURE_FOOT ? 'sure' : 'normal';
  const dc = Math.max(p.get('1X')!, p.get('X2')!);
  return dc >= T_FLIP_FOOT ? 'risky' : 'flip';
}
