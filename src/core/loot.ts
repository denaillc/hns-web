import { Rng } from './rng';
import { addStats, emptyStats, type StatKey, type Stats } from './stats';

export type Slot = 'weapon' | 'helm' | 'armor' | 'gloves' | 'boots' | 'ring';
export const SLOTS: Slot[] = ['weapon', 'helm', 'armor', 'gloves', 'boots', 'ring'];
export const SLOT_LABELS: Record<Slot, string> = {
  weapon: 'Arme',
  helm: 'Casque',
  armor: 'Armure',
  gloves: 'Gants',
  boots: 'Bottes',
  ring: 'Anneau',
};

export type Rarity = 'common' | 'magic' | 'rare' | 'legendary';
export const RARITIES: Rarity[] = ['common', 'magic', 'rare', 'legendary'];
export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Commun',
  magic: 'Magique',
  rare: 'Rare',
  legendary: 'Légendaire',
};
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#d8d2c4',
  magic: '#6f8cff',
  rare: '#f2d14b',
  legendary: '#ff8a2a',
};

export interface Item {
  id: string;
  slot: Slot;
  rarity: Rarity;
  name: string;
  ilvl: number;
  /** Statistiques intrinsèques (dégâts d'arme, armure). */
  base: Partial<Stats>;
  /** Affixes aléatoires. */
  affixes: Partial<Stats>;
}

const BASE_NAMES: Record<Slot, string[]> = {
  weapon: ['Épée courte', 'Glaive', 'Hache', 'Masse', 'Épée longue', 'Fauchon'],
  helm: ['Capuche', 'Heaume', 'Casque à cornes', 'Couronne de fer'],
  armor: ['Gambison', 'Cotte de mailles', 'Brigandine', 'Harnois'],
  gloves: ['Mitaines', 'Gantelets', 'Gants de cuir'],
  boots: ['Sandales', 'Bottes de cuir', 'Grèves'],
  ring: ['Anneau', 'Chevalière', 'Bague'],
};

/** Adjectifs [masculin, féminin]. */
const PREFIXES: [string, string][] = [
  ['Sanglant', 'Sanglante'], ['Runique', 'Runique'], ['Ancien', 'Ancienne'], ['Maudit', 'Maudite'],
  ['Béni', 'Bénie'], ['Funeste', 'Funeste'], ['Ardent', 'Ardente'], ['Noirci', 'Noircie'],
];
const SUFFIXES = [
  'du Loup', 'de la Crypte', 'du Roi Déchu', 'des Ombres', "de l'Ours", 'du Faucon', 'des Âmes', 'de Braise',
];
const LEGENDARY_NAMES: Record<Slot, string[]> = {
  weapon: ['Mord-Tombe', 'Lame de Cendre', 'Brise-Os'],
  helm: ['Regard du Liche', 'Couronne Oubliée'],
  armor: ['Égide du Gardien', 'Peau de Wyrm'],
  gloves: ['Poignes de Fer-Noir', "Mains de l'Exécuteur"],
  boots: ['Pas de Brume', 'Marche-Ombre'],
  ring: ["Œil d'Ombrefer", 'Sceau des Neuf'],
};

/** Plage de valeur d'un affixe pour un niveau d'objet. */
type AffixRoll = (ilvl: number, rng: Rng) => number;

const AFFIXES: { key: StatKey; slots: Slot[] | 'all'; roll: AffixRoll }[] = [
  { key: 'maxHp', slots: 'all', roll: (l, r) => Math.round(r.range(8, 16) + l * r.range(3, 6)) },
  { key: 'maxMana', slots: ['helm', 'ring', 'armor'], roll: (l, r) => Math.round(r.range(6, 12) + l * r.range(1.5, 3)) },
  { key: 'damage', slots: ['weapon', 'gloves', 'ring'], roll: (l, r) => Math.round(r.range(2, 4) + l * r.range(0.8, 1.6)) },
  { key: 'damagePct', slots: ['weapon', 'ring', 'gloves'], roll: (l, r) => round2(r.range(0.05, 0.12) + l * 0.006) },
  { key: 'armor', slots: ['helm', 'armor', 'gloves', 'boots'], roll: (l, r) => Math.round(r.range(4, 9) + l * r.range(1.5, 3)) },
  { key: 'critChance', slots: ['weapon', 'gloves', 'ring', 'helm'], roll: (_l, r) => round3(r.range(0.02, 0.05)) },
  { key: 'critMult', slots: ['weapon', 'ring', 'gloves'], roll: (_l, r) => round2(r.range(0.12, 0.3)) },
  { key: 'attackSpeed', slots: ['weapon', 'gloves', 'ring'], roll: (_l, r) => round2(r.range(0.05, 0.12)) },
  { key: 'moveSpeed', slots: ['boots'], roll: (_l, r) => round2(r.range(0.05, 0.12)) },
  { key: 'lifeOnHit', slots: ['weapon', 'gloves', 'ring'], roll: (l, r) => round1(r.range(1, 2.5) + l * 0.3) },
  { key: 'hpRegen', slots: ['armor', 'helm', 'ring', 'boots'], roll: (l, r) => round1(r.range(0.5, 1.2) + l * 0.15) },
  { key: 'manaRegen', slots: ['helm', 'ring', 'armor', 'boots'], roll: (_l, r) => round1(r.range(0.8, 2)) },
  { key: 'spellPct', slots: ['helm', 'ring', 'weapon'], roll: (l, r) => round2(r.range(0.08, 0.16) + l * 0.006) },
  { key: 'cdr', slots: ['helm', 'gloves', 'ring'], roll: (_l, r) => round2(r.range(0.04, 0.08)) },
];

const INT_KEYS = new Set<StatKey>(['maxHp', 'maxMana', 'damage', 'armor']);

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

let idCounter = 0;
function newId(rng: Rng): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${Date.now().toString(36)}-${idCounter}-${Math.floor(rng.next() * 1e6).toString(36)}`;
}

/**
 * Tire une rareté. `magicFind` (0 = normal) décale les poids vers le haut
 * (élites, boss, étages profonds).
 */
export function rollRarity(rng: Rng, magicFind = 0): Rarity {
  const m = 1 + magicFind;
  return rng.weighted(RARITIES, [60, 28 * m, 9 * m * m, 1.2 * m * m * m]);
}

export function generateItem(rng: Rng, ilvl: number, opts: { slot?: Slot; rarity?: Rarity; magicFind?: number } = {}): Item {
  const slot = opts.slot ?? rng.pick(SLOTS);
  const rarity = opts.rarity ?? rollRarity(rng, opts.magicFind);
  const base: Partial<Stats> = {};
  if (slot === 'weapon') base.damage = Math.round(3 + ilvl * 1.6 + rng.range(0, 3));
  else if (slot === 'armor') base.armor = Math.round(6 + ilvl * 3 + rng.range(0, 4));
  else if (slot === 'ring') base.critChance = 0.01;
  else base.armor = Math.round(3 + ilvl * 1.5 + rng.range(0, 3));

  const nAffixes = { common: 0, magic: rng.int(1, 2), rare: rng.int(3, 4), legendary: 5 }[rarity];
  const affixes: Partial<Stats> = {};
  const pool = AFFIXES.filter((a) => a.slots === 'all' || a.slots.includes(slot));
  const mult = rarity === 'legendary' ? 1.35 : 1;
  for (let i = 0; i < nAffixes && pool.length > 0; i++) {
    const idx = Math.floor(rng.next() * pool.length);
    const a = pool.splice(idx, 1)[0];
    const v = a.roll(ilvl, rng) * mult;
    affixes[a.key] = INT_KEYS.has(a.key) ? Math.round(v) : Math.round(v * 1000) / 1000;
  }

  if (rarity === 'legendary') {
    base.damage = base.damage ? Math.round(base.damage * 1.3) : base.damage;
    base.armor = base.armor ? Math.round(base.armor * 1.3) : base.armor;
  }

  return { id: newId(rng), slot, rarity, name: itemName(rng, slot, rarity), ilvl, base, affixes };
}

function itemName(rng: Rng, slot: Slot, rarity: Rarity): string {
  const baseName = rng.pick(BASE_NAMES[slot]);
  switch (rarity) {
    case 'common':
      return baseName;
    case 'magic':
      return rng.chance(0.5) ? `${baseName} ${rng.pick(SUFFIXES)}` : `${baseName} ${agree(rng.pick(PREFIXES), baseName)}`;
    case 'rare':
      return `${baseName} ${agree(rng.pick(PREFIXES), baseName)} ${rng.pick(SUFFIXES)}`;
    case 'legendary':
      return rng.pick(LEGENDARY_NAMES[slot]);
  }
}

const FEMININE = new Set(['Épée', 'Hache', 'Masse', 'Capuche', 'Couronne', 'Cotte', 'Brigandine', 'Mitaines', 'Sandales', 'Bottes', 'Grèves', 'Chevalière', 'Bague']);
const PLURAL = new Set(['Mitaines', 'Gantelets', 'Gants', 'Sandales', 'Bottes', 'Grèves']);

/** Accorde l'adjectif avec le nom de base (genre et nombre). */
function agree(adj: [string, string], baseName: string): string {
  const first = baseName.split(' ')[0];
  const a = FEMININE.has(first) ? adj[1] : adj[0];
  return PLURAL.has(first) ? a + 's' : a;
}

/** Total des statistiques portées par l'objet. */
export function itemStats(item: Item): Partial<Stats> {
  return addStats(addStats(emptyStats(), item.base), item.affixes);
}

/** Score heuristique pour comparer deux objets (affichage « meilleur / moins bien »). */
const WEIGHTS: Record<StatKey, number> = {
  maxHp: 0.5,
  maxMana: 0.2,
  damage: 3,
  damagePct: 120,
  armor: 0.6,
  critChance: 300,
  critMult: 60,
  attackSpeed: 140,
  moveSpeed: 120,
  lifeOnHit: 3,
  hpRegen: 3,
  manaRegen: 3,
  spellPct: 90,
  cdr: 160,
};

export function itemScore(item: Item): number {
  const s = itemStats(item);
  let score = 0;
  for (const k in s) score += (s[k as StatKey] ?? 0) * WEIGHTS[k as StatKey];
  return score;
}

/** Or obtenu en recyclant un objet. */
export function salvageValue(item: Item): number {
  const m = { common: 1, magic: 3, rare: 8, legendary: 25 }[item.rarity];
  return Math.round((4 + item.ilvl * 2) * m);
}
