// Catalogue des statistiques du direct : n'importe quelle stat entrante (n'importe quel fournisseur, n'importe quelle
// langue, n'importe quel niveau de détail) est rangée sous une clé canonique que le moteur sait lire.
//
//   classify('tennis', 'Backhand unforced errors')       -> { key: 'ue.backhand', group: 'errors', … }
//   classify('tennis', 'Fautes directes en coup droit')  -> { key: 'ue.forehand', … }
//   classify('tennis', 'backhand_unforced_errors')       -> { key: 'ue.backhand', … }
//   classify('tennis', '1st serve points won')           -> { key: 'serve.first.won', … }
//   parseValue('77% (213/277)')                          -> { value: 0.77, made: 213, att: 277, pct: 0.77 }
//
// Une stat inconnue n'est jamais jetée : elle garde son libellé d'origine sous `other.<libellé>` (groupe « other »), pour
// qu'on puisse l'ajouter au catalogue plus tard sans rien perdre de ce qui a été reçu.

export type Sport = 'tennis' | 'foot' | 'nba';
export type Group =
  | 'serve' | 'return' | 'points' | 'winners' | 'errors' | 'net' | 'rally' | 'pressure' | 'physical' | 'speed' // tennis
  | 'attack' | 'chances' | 'possession' | 'passing' | 'defence' | 'discipline' | 'setpiece' | 'goalkeeping' // foot
  | 'shooting' | 'rebounds' | 'playmaking' | 'fouls' | 'scoring' | 'flow' // NBA
  | 'other';

export interface Classified {
  key: string; // clé canonique (« ue.backhand », « serve.first.won », « xg », « fg3 »…)
  group: Group;
  label: string; // libellé d'origine
  /** Nom lisible (français) de la clé canonique. */
  name: string;
  known: boolean;
}

export interface Parsed {
  /** Valeur principale : un nombre, un ratio (0..1) pour un pourcentage, une durée en secondes, une vitesse en km/h. */
  value: number | null;
  made?: number;
  att?: number;
  pct?: number;
  unit?: 'pct' | 'sec' | 'kmh' | 'm' | 'count';
  raw: string;
}

/** Une stat du direct, rangée et lue. */
export interface Stat extends Classified {
  side: 0 | 1; // 0 : domicile / joueur A, 1 : extérieur / joueur B
  period: string; // « all », « set1 », « q3 », « 1h »…
  v: Parsed;
}

// ---------------------------------------------------------------------------------------------------------------------
// Lecture d'une valeur
const toNum = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

export function parseValue(input: unknown): Parsed {
  const raw = input == null ? '' : String(input).trim();
  if (typeof input === 'number') return { value: Number.isFinite(input) ? input : null, raw, unit: 'count' };
  if (!raw || raw === '-' || raw === '–') return { value: null, raw };
  let m = raw.match(/^(-?[\d.,]+)\s*%\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)$/); // 77% (213/277)
  if (m) return { value: toNum(m[1]) / 100, pct: toNum(m[1]) / 100, made: Number(m[2]), att: Number(m[3]), unit: 'pct', raw };
  m = raw.match(/^(\d+)\s*\/\s*(\d+)\s*(?:\(\s*(-?[\d.,]+)\s*%\s*\))?$/); // 12/20 (60%)
  if (m) { const made = Number(m[1]), att = Number(m[2]); return { value: att ? made / att : null, made, att, pct: att ? made / att : undefined, unit: 'pct', raw }; }
  m = raw.match(/^(\d+)\s*-\s*(\d+)$/); // 30-79 (NBA : réussis-tentés)
  if (m) { const made = Number(m[1]), att = Number(m[2]); return { value: att ? made / att : null, made, att, pct: att ? made / att : undefined, unit: 'pct', raw }; }
  m = raw.match(/^(\d+)\s+of\s+(\d+)$/i); // 4 of 7
  if (m) { const made = Number(m[1]), att = Number(m[2]); return { value: att ? made / att : null, made, att, pct: att ? made / att : undefined, unit: 'pct', raw }; }
  m = raw.match(/^(-?[\d.,]+)\s*%$/);
  if (m) return { value: toNum(m[1]) / 100, pct: toNum(m[1]) / 100, unit: 'pct', raw };
  m = raw.match(/^(?:(\d+):)?(\d+):(\d{2})$/); // 1:45:02 / 45:02
  if (m) return { value: (Number(m[1] ?? 0) * 3600) + Number(m[2]) * 60 + Number(m[3]), unit: 'sec', raw };
  m = raw.match(/^([\d.,]+)\s*(km\/h|kmh)$/i);
  if (m) return { value: toNum(m[1]), unit: 'kmh', raw };
  m = raw.match(/^([\d.,]+)\s*mph$/i);
  if (m) return { value: toNum(m[1]) * 1.609344, unit: 'kmh', raw };
  m = raw.match(/^([\d.,]+)\s*(m|km)$/i);
  if (m) return { value: toNum(m[1]) * (m[2].toLowerCase() === 'km' ? 1000 : 1), unit: 'm', raw };
  const n = toNum(raw);
  return Number.isFinite(n) ? { value: n, unit: 'count', raw } : { value: null, raw };
}

// ---------------------------------------------------------------------------------------------------------------------
// Libellés : mots-clés multilingues -> notions
const norm = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\-./:()%]+/g, ' ').replace(/\s+/g, ' ').trim();

type Rx = RegExp;
const T = {
  unforced: /\b(unforced|ue|fautes? directes?|errores? no forzados?|no forzados?|gratuit[io]|errori gratuiti|unerzwungene?|eigenfehler)\b/,
  forced: /\b(forced|fe|fautes? provoquees?|errores? forzados?|forzati|erzwungene?)\b/,
  error: /\b(errors?|fautes?|errores?|errori|fehler)\b/,
  winner: /\b(winners?|coups? gagnants?|gagnants?|golpes ganadores|ganadores|vincenti|winner schlage)\b/,
  forehand: /\b(forehand|fh|coup droit|derecha|drive|dritto|vorhand)\b/,
  backhand: /\b(backhand|bh|revers|reves|rovescio|ruckhand)\b/,
  volley: /\b(volleys?|volees?|voleas?|volee)\b/,
  smash: /\b(smash|overhead|smashes)\b/,
  drop: /\b(drop shots?|drops?|amorties?|dejadas?|smorzate?|stopp)\b/,
  lob: /\b(lobs?|globos?|pallonetti)\b/,
  groundstroke: /\b(groundstrokes?|fond de court)\b/,
  passing: /\b(passing shots?|passings?)\b/,
  return: /\b(returns?|retours?|restos?|risposta|ruckschlag)\b/,
  serve: /\b(serves?|services?|servicio|servizio|aufschlag|serving)\b/,
  ace: /\b(aces?)\b/,
  doubleFault: /\b(double faults?|doubles? fautes?|dobles? faltas?|doppi falli|doppelfehler|df)\b/,
  first: /\b(1st|first|1er|premiere?s?|primer|prima|erste)\b/,
  second: /\b(2nd|second|2e|2eme|deuxiemes?|seconde?s?|segundo|seconda|zweite)\b/,
  won: /\b(won|win|gagnes?|ganados?|vinti|gewonnen|pts won|points won)\b/,
  inPct: /\b(in|%|percentage|pourcentage|reussite|percent)\b/,
  points: /\b(points?|pts|puntos?|punti|punkte)\b/,
  games: /\b(games?|jeux|juegos?|giochi|spiele)\b/,
  breakPt: /\b(break points?|balles? de break|bp|puntos de quiebre|palle break|breakballe)\b/,
  saved: /\b(saved|sauvees?|salvad[oa]s|salvate|abgewehrt)\b/,
  converted: /\b(converted|convertis|converties|convertid[oa]s|convertite|genutzt)\b/,
  net: /\b(net|filet|red|rete|netz)\b/,
  rally: /\b(rally|rallies|echanges?|peloteo|scambi)\b/,
  inRow: /\b(in a row|consecutifs?|consecutivos|di fila|in folge|streak|serie)\b/,
  total: /\b(total|totaux?)\b/,
  speed: /\b(speed|vitesse|velocidad|velocita|geschwindigkeit)\b/,
  distance: /\b(distance|distancia|km run|run)\b/,
  duration: /\b(duration|duree|tiempo|durata|dauer|time)\b/,
  max: /\b(max|maximum|fastest|plus rapide|top)\b/,
  avg: /\b(avg|average|moyenne?|promedio|media)\b/,
};
const has = (s: string, r: Rx) => r.test(s);
const strokeOf = (s: string): string | undefined => {
  if (has(s, T.forehand)) return 'forehand';
  if (has(s, T.backhand)) return 'backhand';
  if (has(s, T.volley)) return 'volley';
  if (has(s, T.smash)) return 'smash';
  if (has(s, T.drop)) return 'drop';
  if (has(s, T.lob)) return 'lob';
  if (has(s, T.passing)) return 'passing';
  if (has(s, T.groundstroke)) return 'groundstroke';
  if (has(s, T.return)) return 'return';
  return undefined;
};

/** Noms lisibles des clés canoniques. */
export const NAMES: Record<string, string> = {
  'serve.aces': 'Aces', 'serve.df': 'Doubles fautes', 'serve.first.in': '1re balle passée', 'serve.first.won': 'Points gagnés sur 1re balle',
  'serve.second.won': 'Points gagnés sur 2e balle', 'serve.won': 'Points gagnés au service', 'serve.games.won': 'Jeux de service gagnés',
  'serve.bp.saved': 'Balles de break sauvées', 'serve.speed.max': 'Service le plus rapide', 'serve.speed.avg': 'Vitesse moyenne de service',
  'serve.speed.first': 'Vitesse moyenne 1re balle', 'serve.speed.second': 'Vitesse moyenne 2e balle',
  'return.won': 'Points gagnés en retour', 'return.first.won': 'Retours gagnés sur 1re balle', 'return.second.won': 'Retours gagnés sur 2e balle',
  'return.bp.converted': 'Balles de break converties', 'return.games.won': 'Jeux de retour gagnés',
  'points.won': 'Points gagnés', 'points.inrow': 'Points d\'affilée (max)', 'games.inrow': 'Jeux d\'affilée (max)',
  'winners': 'Coups gagnants', 'ue': 'Fautes directes', 'fe': 'Fautes provoquées', 'net.won': 'Points gagnés au filet',
  'rally.avg': 'Longueur moyenne des échanges', 'distance': 'Distance parcourue', 'duration': 'Durée',
  // foot
  'poss': 'Possession', 'shots': 'Tirs', 'sot': 'Tirs cadrés', 'shots.off': 'Tirs non cadrés', 'shots.blocked': 'Tirs contrés', 'shots.box': 'Tirs dans la surface',
  'shots.outbox': 'Tirs hors de la surface', 'xg': 'Buts attendus (xG)', 'xgot': 'xG cadrés', 'xa': 'Passes décisives attendues (xA)', 'bigc': 'Grosses occasions',
  'bigc.missed': 'Grosses occasions manquées', 'corners': 'Corners', 'fouls': 'Fautes', 'yellow': 'Cartons jaunes', 'red': 'Cartons rouges',
  'offsides': 'Hors-jeu', 'saves': 'Arrêts', 'passes': 'Passes', 'passes.acc': 'Passes réussies', 'crosses': 'Centres', 'long': 'Longs ballons',
  'tackles': 'Tacles', 'inter': 'Interceptions', 'clear': 'Dégagements', 'duels': 'Duels gagnés', 'aerial': 'Duels aériens gagnés',
  'dribbles': 'Dribbles réussis', 'tbox': 'Ballons touchés dans la surface', 'wood': 'Poteaux', 'freekicks': 'Coups francs', 'throwins': 'Touches',
  'goalkicks': 'Sorties de but', 'dangerous': 'Attaques dangereuses', 'attacks': 'Attaques',
  // NBA
  'fg': 'Tirs', 'fg2': 'Tirs à 2 pts', 'fg3': 'Tirs à 3 pts', 'ft': 'Lancers francs', 'reb': 'Rebonds', 'reb.off': 'Rebonds offensifs', 'reb.def': 'Rebonds défensifs',
  'ast': 'Passes décisives', 'tov': 'Pertes de balle', 'stl': 'Interceptions', 'blk': 'Contres', 'pf': 'Fautes', 'tech': 'Fautes techniques',
  'paint': 'Points dans la raquette', 'fastbreak': 'Points en contre-attaque', 'second': 'Points de seconde chance', 'tovpts': 'Points sur pertes de balle',
  'bench': 'Points du banc', 'lead.max': 'Plus grosse avance', 'leadchanges': 'Changements de leader', 'timeouts': 'Temps morts restants', 'run.max': 'Plus grosse série',
};

function tennisKey(s: string): [string, Group] | undefined {
  const st = strokeOf(s);
  const stroke = st && st !== 'return' ? `.${st}` : st === 'return' ? '.return' : '';
  if (has(s, T.doubleFault)) return ['serve.df', 'serve'];
  if (has(s, T.ace) && !has(s, T.points)) return ['serve.aces', 'serve'];
  if (has(s, T.unforced)) return [`ue${stroke}`, 'errors'];
  if (has(s, T.forced) && has(s, T.error)) return [`fe${stroke}`, 'errors'];
  if (has(s, T.forced) && !has(s, T.winner)) return [`fe${stroke}`, 'errors'];
  if (has(s, T.winner) && !has(s, T.points)) return [`winners${stroke}`, 'winners'];
  if (has(s, T.breakPt)) {
    if (has(s, T.saved)) return ['serve.bp.saved', 'pressure'];
    if (has(s, T.converted) || has(s, T.won)) return ['return.bp.converted', 'pressure'];
    if (has(s, T.serve)) return ['serve.bp.saved', 'pressure'];
    return ['return.bp.converted', 'pressure'];
  }
  if (/\b(fastest|plus rapide|mas rapido|piu veloce)\b/.test(s)) return ['serve.speed.max', 'speed'];
  if (has(s, T.speed)) return [has(s, T.first) ? 'serve.speed.first' : has(s, T.second) ? 'serve.speed.second' : has(s, T.avg) ? 'serve.speed.avg' : 'serve.speed.max', 'speed'];
  if (has(s, T.inRow)) return [has(s, T.games) ? 'games.inrow' : 'points.inrow', 'points'];
  if (has(s, T.net)) return ['net.won', 'net'];
  if (has(s, T.rally)) return ['rally.avg', 'rally'];
  if (has(s, T.distance)) return ['distance', 'physical'];
  if (has(s, T.duration)) return ['duration', 'physical'];
  if (has(s, T.return) || /\breceiv/.test(s) || /\bretour\b/.test(s)) {
    if (has(s, T.games)) return ['return.games.won', 'return'];
    if (has(s, T.first)) return ['return.first.won', 'return'];
    if (has(s, T.second)) return ['return.second.won', 'return'];
    return ['return.won', 'return'];
  }
  if (has(s, T.serve) || has(s, T.first) || has(s, T.second)) {
    if (has(s, T.games)) return ['serve.games.won', 'serve'];
    if (has(s, T.first)) return [has(s, T.won) || has(s, T.points) ? 'serve.first.won' : 'serve.first.in', 'serve'];
    if (has(s, T.second)) return ['serve.second.won', 'serve'];
    return ['serve.won', 'serve'];
  }
  if (has(s, T.points) && (has(s, T.total) || has(s, T.won))) return ['points.won', 'points'];
  return undefined;
}

const FOOT: Array<[Rx, string, Group]> = [
  [/\b(xgot|expected goals on target|xg on target)\b/, 'xgot', 'chances'],
  [/\b(xa|expected assists?)\b/, 'xa', 'chances'],
  [/\b(xg|expected goals?|buts attendus|goles esperados)\b/, 'xg', 'chances'],
  [/\b(big chances? missed|grosses occasions manquees)\b/, 'bigc.missed', 'chances'],
  [/\b(big chances?|grosses occasions|ocasiones claras)\b/, 'bigc', 'chances'],
  [/\b(shots? on (target|goal)|tirs cadres|tiros a puerta|on target)\b/, 'sot', 'attack'],
  [/\b(shots? off (target|goal)|tirs non cadres|off target)\b/, 'shots.off', 'attack'],
  [/\b(blocked shots?|tirs contres)\b/, 'shots.blocked', 'attack'],
  [/\b(shots? inside( the)? box|tirs dans la surface)\b/, 'shots.box', 'attack'],
  [/\b(shots? outside( the)? box|tirs hors de la surface)\b/, 'shots.outbox', 'attack'],
  [/\b(total shots?|shots?|tirs|tiros)\b/, 'shots', 'attack'],
  [/\b(possession|ball possession|posesion)\b/, 'poss', 'possession'],
  [/\b(touches in (opposition|opp) box|touches? (dans la )?surface)\b/, 'tbox', 'attack'],
  [/\b(dangerous attacks?|attaques dangereuses)\b/, 'dangerous', 'attack'],
  [/\b(attacks?|attaques)\b/, 'attacks', 'attack'],
  [/\b(corners?|corner kicks?)\b/, 'corners', 'setpiece'],
  [/\b(free kicks?|coups francs)\b/, 'freekicks', 'setpiece'],
  [/\b(throw ins?|touches)\b/, 'throwins', 'setpiece'],
  [/\b(goal kicks?|sorties de but)\b/, 'goalkicks', 'setpiece'],
  [/\b(yellow cards?|cartons jaunes|amarillas)\b/, 'yellow', 'discipline'],
  [/\b(red cards?|cartons rouges|rojas)\b/, 'red', 'discipline'],
  [/\b(fouls?( committed)?|fautes|faltas)\b/, 'fouls', 'discipline'],
  [/\b(offsides?|hors jeu|fueras de juego)\b/, 'offsides', 'discipline'],
  [/\b(keeper saves?|goalkeeper saves?|saves|arrets|paradas)\b/, 'saves', 'goalkeeping'],
  [/\b(accurate passes|passes reussies|pass(es)? accuracy|passing accuracy)\b/, 'passes.acc', 'passing'],
  [/\b(crosses|centres)\b/, 'crosses', 'passing'],
  [/\b(long balls|longs ballons)\b/, 'long', 'passing'],
  [/\b(passes|pases)\b/, 'passes', 'passing'],
  [/\b(tackles?|tacles)\b/, 'tackles', 'defence'],
  [/\b(interceptions?)\b/, 'inter', 'defence'],
  [/\b(clearances?|degagements)\b/, 'clear', 'defence'],
  [/\b(aerial duels?|duels aeriens)\b/, 'aerial', 'defence'],
  [/\b(duels? won|duels? gagnes|duels?)\b/, 'duels', 'defence'],
  [/\b(dribbles?|successful dribbles|dribbles reussis)\b/, 'dribbles', 'attack'],
  [/\b(woodwork|poteaux|hit woodwork)\b/, 'wood', 'chances'],
];
const NBA: Array<[Rx, string, Group]> = [
  [/\b(3 ?(pt|pts|point|points)|three point|fg3|3fg|tirs a 3)\b/, 'fg3', 'shooting'],
  [/\b(2 ?(pt|pts|point|points)|two point|fg2|tirs a 2)\b/, 'fg2', 'shooting'],
  [/\b(free throws?|ft|lancers? francs?)\b/, 'ft', 'shooting'],
  [/\b(field goals?|fg|tirs)\b/, 'fg', 'shooting'],
  [/\b(offensive rebounds?|rebonds offensifs|oreb)\b/, 'reb.off', 'rebounds'],
  [/\b(defensive rebounds?|rebonds defensifs|dreb)\b/, 'reb.def', 'rebounds'],
  [/\b(rebounds?|rebonds|reb)\b/, 'reb', 'rebounds'],
  [/\b(assists?|passes decisives|ast)\b/, 'ast', 'playmaking'],
  [/\b(points? (off|from|on) turnovers?|turnover points|points sur pertes)\b/, 'tovpts', 'scoring'],
  [/\b(turnovers?|pertes de balle|tov|to)\b/, 'tov', 'playmaking'],
  [/\b(steals?|interceptions|stl)\b/, 'stl', 'defence'],
  [/\b(blocks?|contres|blk)\b/, 'blk', 'defence'],
  [/\b(technical fouls?|fautes techniques)\b/, 'tech', 'fouls'],
  [/\b(personal fouls?|fouls?|fautes|pf)\b/, 'pf', 'fouls'],
  [/\b(points in (the )?paint|points dans la raquette|paint)\b/, 'paint', 'scoring'],
  [/\b(fast ?break|contre attaque)\b/, 'fastbreak', 'scoring'],
  [/\b(second chance|seconde chance)\b/, 'second', 'scoring'],
  [/\b(bench points|points du banc)\b/, 'bench', 'scoring'],
  [/\b(largest lead|biggest lead|plus grosse avance)\b/, 'lead.max', 'flow'],
  [/\b(lead changes|changements de leader)\b/, 'leadchanges', 'flow'],
  [/\b(timeouts?( remaining)?|temps morts)\b/, 'timeouts', 'flow'],
  [/\b(biggest (scoring )?run|plus grosse serie)\b/, 'run.max', 'flow'],
];

/** Range un libellé de stat de n'importe quel fournisseur sous une clé canonique du sport. */
export function classify(sport: Sport, label: string): Classified {
  const s = norm(label);
  let hit: [string, Group] | undefined;
  if (sport === 'tennis') hit = tennisKey(s);
  else for (const [rx, key, group] of sport === 'foot' ? FOOT : NBA) if (rx.test(s)) { hit = [key, group]; break; }
  if (!hit) return { key: `other.${s.replace(/ /g, '_')}`, group: 'other', label, name: label, known: false };
  const [key, group] = hit;
  const base = key.split('.').slice(0, 1)[0];
  const name = NAMES[key] ?? (NAMES[base] ? `${NAMES[base]} (${STROKE_FR[key.split('.')[1]] ?? key.split('.')[1]})` : key);
  return { key, group, label, name, known: true };
}
const STROKE_FR: Record<string, string> = { forehand: 'coup droit', backhand: 'revers', volley: 'volée', smash: 'smash', drop: 'amortie', lob: 'lob', passing: 'passing', groundstroke: 'fond de court', return: 'retour' };

/** Période d'une stat à partir de son libellé de fournisseur (« 1st set », « Q3 », « 2nd half », « ALL »…). */
export function periodOf(label?: string | null): string {
  const s = norm(label ?? '');
  if (!s || /\b(all|match|total|game|full)\b/.test(s)) return 'all';
  let m = s.match(/\b(\d)(st|nd|rd|th|e|er)? set\b|\bset (\d)\b/);
  if (m) return `set${m[1] ?? m[3]}`;
  m = s.match(/\bq ?(\d)\b|\b(\d)(st|nd|rd|th)? quarter\b|\b(\d)e? quart/);
  if (m) return `q${m[1] ?? m[2] ?? m[4]}`;
  if (/\b(1st|first|1re|premiere) half\b|\b1 ?h\b|\b1re mi temps\b/.test(s)) return '1h';
  if (/\b(2nd|second|2e|seconde) half\b|\b2 ?h\b|\b2e mi temps\b/.test(s)) return '2h';
  if (/\b(ot|overtime|prolongation)/.test(s)) return 'ot';
  return s.replace(/ /g, '_');
}

/** Ligne brute d'un fournisseur (libellé, valeurs des deux côtés, période) -> deux stats rangées. */
export function statsFromRow(sport: Sport, row: { label: string; home: unknown; away: unknown; period?: string | null }): Stat[] {
  const c = classify(sport, row.label);
  const period = periodOf(row.period);
  return [
    { ...c, side: 0, period, v: parseValue(row.home) },
    { ...c, side: 1, period, v: parseValue(row.away) },
  ];
}

/** Toutes les stats d'un match indexées : get('ue.backhand', 0) -> valeur, made, att… (période « all » par défaut). */
export class StatBook {
  readonly all: Stat[] = [];
  private by = new Map<string, Stat>();
  add(stats: Stat[]): this {
    for (const s of stats) { this.all.push(s); this.by.set(`${s.period}|${s.key}|${s.side}`, s); }
    return this;
  }
  get(key: string, side: 0 | 1, period = 'all'): Parsed | undefined { return this.by.get(`${period}|${key}|${side}`)?.v; }
  /** Somme d'une famille (« ue » : toutes les fautes directes, par coup compris si seul le détail est fourni). */
  family(prefix: string, side: 0 | 1, period = 'all'): number | null {
    const whole = this.get(prefix, side, period)?.value;
    if (whole != null) return whole;
    let t = 0, any = false;
    for (const s of this.all) if (s.side === side && s.period === period && s.key.startsWith(`${prefix}.`) && s.v.value != null) { t += s.v.value; any = true; }
    return any ? t : null;
  }
  unknown(): Stat[] { return this.all.filter((s) => !s.known); }
}
