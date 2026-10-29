import { describe, expect, it } from 'vitest';
import { bfs, FLOOR, generateDungeon } from '../src/core/dungeon';
import { FlowField } from '../src/core/flowfield';
import { Rng } from '../src/core/rng';
import { generateItem, itemScore, RARITIES, SLOTS } from '../src/core/loot';
import {
  addToInventory,
  computeStats,
  equipFromInventory,
  gainXp,
  INVENTORY_SIZE,
  newCharacter,
  salvage,
} from '../src/core/character';
import { mitigate, xpToNext } from '../src/core/stats';

describe('Rng', () => {
  it('est déterministe pour une même graine', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('reste dans les bornes', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe('generateDungeon', () => {
  it.each([1, 2, 3, 99, 12345, 987654])('graine %i : toutes les salles sont connectées', (seed) => {
    const d = generateDungeon(seed);
    expect(d.rooms.length).toBeGreaterThanOrEqual(6);
    const start = d.rooms[d.startRoom];
    const dist = bfs(d.tiles, d.w, d.h, start.cx, start.cy);
    for (const r of d.rooms) expect(dist[r.cy * d.w + r.cx]).toBeGreaterThanOrEqual(0);
    expect(d.exitRoom).not.toBe(d.startRoom);
  });

  it('garde une bordure de murs', () => {
    const d = generateDungeon(5);
    for (let x = 0; x < d.w; x++) {
      expect(d.tiles[x]).not.toBe(FLOOR);
      expect(d.tiles[(d.h - 1) * d.w + x]).not.toBe(FLOOR);
    }
  });
});

describe('FlowField', () => {
  it('mène vers la cible en contournant les murs', () => {
    const d = generateDungeon(11);
    const ff = new FlowField(d.tiles, d.w, d.h, 500);
    const target = d.rooms[d.startRoom];
    ff.compute(target.cx, target.cy);
    const from = d.rooms[d.exitRoom];
    let x = from.cx;
    let y = from.cy;
    for (let steps = 0; steps < 1000; steps++) {
      const n = ff.next(x, y);
      if (!n) break;
      [x, y] = n;
      expect(d.tiles[y * d.w + x]).toBe(FLOOR);
    }
    expect([x, y]).toEqual([target.cx, target.cy]);
  });
});

describe('loot', () => {
  it('génère des objets valides pour chaque emplacement et rareté', () => {
    const rng = new Rng(3);
    for (const slot of SLOTS) {
      for (const rarity of RARITIES) {
        const it = generateItem(rng, 5, { slot, rarity });
        expect(it.slot).toBe(slot);
        expect(it.name.length).toBeGreaterThan(2);
        const n = Object.keys(it.affixes).length;
        if (rarity === 'common') expect(n).toBe(0);
        if (rarity === 'legendary') expect(n).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('les objets de haut niveau valent plus', () => {
    const rng = new Rng(9);
    let low = 0;
    let high = 0;
    for (let i = 0; i < 200; i++) {
      low += itemScore(generateItem(rng, 1, { rarity: 'rare', slot: 'weapon' }));
      high += itemScore(generateItem(rng, 20, { rarity: 'rare', slot: 'weapon' }));
    }
    expect(high).toBeGreaterThan(low);
  });
});

describe('character', () => {
  it('monte de niveau avec assez d’XP', () => {
    const c = newCharacter();
    const levels = gainXp(c, xpToNext(1) + xpToNext(2) + 1);
    expect(levels).toBe(2);
    expect(c.level).toBe(3);
    expect(c.xp).toBe(1);
  });

  it('équiper échange avec l’objet porté', () => {
    const c = newCharacter();
    const rng = new Rng(1);
    const a = generateItem(rng, 1, { slot: 'weapon', rarity: 'common' });
    const b = generateItem(rng, 1, { slot: 'weapon', rarity: 'magic' });
    addToInventory(c, a);
    addToInventory(c, b);
    const dmg0 = computeStats(c).damage;
    equipFromInventory(c, a.id);
    expect(c.equipment.weapon?.id).toBe(a.id);
    expect(computeStats(c).damage).toBeGreaterThan(dmg0);
    equipFromInventory(c, b.id);
    expect(c.equipment.weapon?.id).toBe(b.id);
    expect(c.inventory.map((i) => i.id)).toEqual([a.id]);
  });

  it('le sac a une capacité limitée et le recyclage rapporte de l’or', () => {
    const c = newCharacter();
    const rng = new Rng(2);
    for (let i = 0; i < INVENTORY_SIZE; i++) expect(addToInventory(c, generateItem(rng, 1))).toBe(true);
    expect(addToInventory(c, generateItem(rng, 1))).toBe(false);
    const gold = salvage(c, c.inventory[0].id);
    expect(gold).toBeGreaterThan(0);
    expect(c.gold).toBe(gold);
    expect(c.inventory.length).toBe(INVENTORY_SIZE - 1);
  });

  it('l’armure réduit les dégâts avec rendements décroissants', () => {
    expect(mitigate(100, 0)).toBe(100);
    expect(mitigate(100, 100)).toBe(50);
    expect(mitigate(100, 300)).toBe(25);
  });
});
