/** Statistiques dérivées du personnage. Tout est pur et testable. */

export type StatKey =
  | 'maxHp'
  | 'maxMana'
  | 'damage'
  | 'damagePct'
  | 'armor'
  | 'critChance'
  | 'critMult'
  | 'attackSpeed'
  | 'moveSpeed'
  | 'lifeOnHit'
  | 'hpRegen'
  | 'manaRegen'
  | 'spellPct'
  | 'cdr';

export type Stats = Record<StatKey, number>;

export const STAT_LABELS: Record<StatKey, (v: number) => string> = {
  maxHp: (v) => `+${fmt(v)} Vie`,
  maxMana: (v) => `+${fmt(v)} Mana`,
  damage: (v) => `+${fmt(v)} Dégâts`,
  damagePct: (v) => `+${fmt(v * 100)}% Dégâts`,
  armor: (v) => `+${fmt(v)} Armure`,
  critChance: (v) => `+${fmt(v * 100, 1)}% Chance de critique`,
  critMult: (v) => `+${fmt(v * 100)}% Dégâts critiques`,
  attackSpeed: (v) => `+${fmt(v * 100)}% Vitesse d'attaque`,
  moveSpeed: (v) => `+${fmt(v * 100)}% Vitesse de déplacement`,
  lifeOnHit: (v) => `+${fmt(v, 1)} Vie par coup`,
  hpRegen: (v) => `+${fmt(v, 1)} Vie /s`,
  manaRegen: (v) => `+${fmt(v, 1)} Mana /s`,
  spellPct: (v) => `+${fmt(v * 100)}% Dégâts des sorts`,
  cdr: (v) => `-${fmt(v * 100)}% Temps de recharge`,
};

function fmt(v: number, digits = 0): string {
  return v.toFixed(digits).replace(/\.0$/, '');
}

export function emptyStats(): Stats {
  return {
    maxHp: 0,
    maxMana: 0,
    damage: 0,
    damagePct: 0,
    armor: 0,
    critChance: 0,
    critMult: 0,
    attackSpeed: 0,
    moveSpeed: 0,
    lifeOnHit: 0,
    hpRegen: 0,
    manaRegen: 0,
    spellPct: 0,
    cdr: 0,
  };
}

/** Statistiques de base d'un personnage nu au niveau donné. */
export function baseStats(level: number): Stats {
  const l = level - 1;
  return {
    ...emptyStats(),
    maxHp: 100 + 14 * l,
    maxMana: 60 + 6 * l,
    damage: 8 + 2.2 * l,
    critChance: 0.05,
    critMult: 1.5,
    attackSpeed: 1,
    moveSpeed: 1,
    hpRegen: 0.6 + 0.15 * l,
    manaRegen: 4 + 0.25 * l,
  };
}

export function addStats(into: Stats, from: Partial<Stats>): Stats {
  for (const k in from) {
    const key = k as StatKey;
    into[key] += from[key] ?? 0;
  }
  return into;
}

/** Plafonds pour éviter les builds absurdes. */
export function clampStats(s: Stats): Stats {
  s.critChance = Math.min(s.critChance, 0.75);
  s.attackSpeed = Math.min(s.attackSpeed, 2.5);
  s.moveSpeed = Math.min(s.moveSpeed, 1.6);
  s.cdr = Math.min(s.cdr, 0.5);
  return s;
}

/** XP nécessaire pour passer du niveau `level` au suivant. */
export function xpToNext(level: number): number {
  return Math.round(60 * Math.pow(level, 1.55));
}

/** Réduction des dégâts par l'armure (rendements décroissants). */
export function mitigate(damage: number, armor: number): number {
  return damage * (100 / (100 + Math.max(0, armor)));
}

/** Multiplicateurs de difficulté des monstres selon l'étage. */
export function monsterScaling(floor: number): { hp: number; damage: number; xp: number } {
  const f = Math.max(0, floor - 1);
  return {
    hp: 1 + 0.38 * f + 0.02 * f * f,
    damage: 1 + 0.22 * f,
    xp: 1 + 0.3 * f,
  };
}
