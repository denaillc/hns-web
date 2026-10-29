import { itemStats, salvageValue, SLOTS, type Item, type Slot } from './loot';
import { addStats, baseStats, clampStats, xpToNext, type Stats } from './stats';

export const INVENTORY_SIZE = 24;
export const MAX_POTIONS = 5;

export interface Character {
  level: number;
  xp: number;
  gold: number;
  potions: number;
  floor: number;
  kills: number;
  inventory: Item[];
  equipment: Record<Slot, Item | null>;
}

export function newCharacter(): Character {
  const equipment = Object.fromEntries(SLOTS.map((s) => [s, null])) as Record<Slot, Item | null>;
  return { level: 1, xp: 0, gold: 0, potions: 3, floor: 1, kills: 0, inventory: [], equipment };
}

export function computeStats(c: Character): Stats {
  const s = baseStats(c.level);
  for (const slot of SLOTS) {
    const it = c.equipment[slot];
    if (it) addStats(s, itemStats(it));
  }
  return clampStats(s);
}

/** Ajoute de l'XP ; renvoie le nombre de niveaux gagnés. */
export function gainXp(c: Character, amount: number): number {
  c.xp += amount;
  let gained = 0;
  while (c.xp >= xpToNext(c.level)) {
    c.xp -= xpToNext(c.level);
    c.level++;
    gained++;
  }
  return gained;
}

/** Ajoute un objet au sac ; false si le sac est plein. */
export function addToInventory(c: Character, item: Item): boolean {
  if (c.inventory.length >= INVENTORY_SIZE) return false;
  c.inventory.push(item);
  return true;
}

/** Équipe un objet du sac (l'objet remplacé retourne dans le sac). */
export function equipFromInventory(c: Character, itemId: string): boolean {
  const idx = c.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return false;
  const item = c.inventory[idx];
  const previous = c.equipment[item.slot];
  c.equipment[item.slot] = item;
  if (previous) c.inventory[idx] = previous;
  else c.inventory.splice(idx, 1);
  return true;
}

export function unequip(c: Character, slot: Slot): boolean {
  const it = c.equipment[slot];
  if (!it || c.inventory.length >= INVENTORY_SIZE) return false;
  c.equipment[slot] = null;
  c.inventory.push(it);
  return true;
}

/** Recycle un objet du sac contre de l'or ; renvoie l'or gagné. */
export function salvage(c: Character, itemId: string): number {
  const idx = c.inventory.findIndex((i) => i.id === itemId);
  if (idx < 0) return 0;
  const v = salvageValue(c.inventory[idx]);
  c.inventory.splice(idx, 1);
  c.gold += v;
  return v;
}

/** Équipe automatiquement si l'emplacement est vide. Renvoie true si équipé. */
export function autoEquipIfEmpty(c: Character, item: Item): boolean {
  if (c.equipment[item.slot]) return false;
  c.equipment[item.slot] = item;
  return true;
}

/** Prix d'une potion chez le marchand de fin d'étage. */
export function potionPrice(c: Character): number {
  return 25 + c.floor * 10;
}
