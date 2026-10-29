import { Rng } from './rng';

export const WALL = 0;
export const FLOOR = 1;

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface Dungeon {
  w: number;
  h: number;
  tiles: Uint8Array;
  rooms: Room[];
  /** Salle de départ (index dans `rooms`). */
  startRoom: number;
  /** Salle la plus éloignée du départ : sortie / boss. */
  exitRoom: number;
  /** Cases de mur bordant le sol, orientées vers la salle : candidates pour les torches. */
  torches: { x: number; y: number }[];
}

export interface DungeonOptions {
  w?: number;
  h?: number;
  rooms?: number;
}

/**
 * Génère un donjon « salles + couloirs ».
 * Les salles sont placées aléatoirement sans chevauchement, puis reliées
 * dans l'ordre par des couloirs en L de largeur 2, plus quelques boucles.
 */
export function generateDungeon(seed: number, opts: DungeonOptions = {}): Dungeon {
  const w = opts.w ?? 64;
  const h = opts.h ?? 64;
  const target = opts.rooms ?? 10;
  const rng = new Rng(seed);
  const tiles = new Uint8Array(w * h);
  const rooms: Room[] = [];

  let attempts = 0;
  while (rooms.length < target && attempts++ < 600) {
    const rw = rng.int(7, 13);
    const rh = rng.int(7, 13);
    const x = rng.int(2, w - rw - 3);
    const y = rng.int(2, h - rh - 3);
    const overlaps = rooms.some(
      (r) => x < r.x + r.w + 3 && x + rw + 3 > r.x && y < r.y + r.h + 3 && y + rh + 3 > r.y,
    );
    if (overlaps) continue;
    rooms.push({ x, y, w: rw, h: rh, cx: Math.floor(x + rw / 2), cy: Math.floor(y + rh / 2) });
  }

  // Trie les salles pour que les couloirs successifs restent courts.
  rooms.sort((a, b) => a.cx + a.cy * 0.7 - (b.cx + b.cy * 0.7));

  for (const r of rooms) carveRect(tiles, w, r.x, r.y, r.w, r.h);

  const corridor = (a: Room, b: Room) => {
    const horizontalFirst = rng.chance(0.5);
    if (horizontalFirst) {
      carveRect(tiles, w, Math.min(a.cx, b.cx), a.cy, Math.abs(a.cx - b.cx) + 2, 2);
      carveRect(tiles, w, b.cx, Math.min(a.cy, b.cy), 2, Math.abs(a.cy - b.cy) + 2);
    } else {
      carveRect(tiles, w, a.cx, Math.min(a.cy, b.cy), 2, Math.abs(a.cy - b.cy) + 2);
      carveRect(tiles, w, Math.min(a.cx, b.cx), b.cy, Math.abs(a.cx - b.cx) + 2, 2);
    }
  };

  for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
  // Quelques boucles pour éviter un donjon strictement linéaire.
  for (let i = 0; i < Math.floor(rooms.length / 4); i++) {
    const a = rng.pick(rooms);
    const b = rng.pick(rooms);
    if (a !== b) corridor(a, b);
  }

  // Quelques piliers au milieu des grandes salles pour casser les lignes de vue.
  for (const r of rooms) {
    if (r.w >= 10 && r.h >= 10 && rng.chance(0.6)) {
      const px = r.x + 2 + rng.int(0, 1);
      const py = r.y + 2 + rng.int(0, 1);
      setTile(tiles, w, px, py, WALL);
      setTile(tiles, w, r.x + r.w - 3, py, WALL);
      setTile(tiles, w, px, r.y + r.h - 3, WALL);
      setTile(tiles, w, r.x + r.w - 3, r.y + r.h - 3, WALL);
    }
  }

  const startRoom = 0;
  const dist = bfs(tiles, w, h, rooms[startRoom].cx, rooms[startRoom].cy);
  let exitRoom = rooms.length - 1;
  let best = -1;
  rooms.forEach((r, i) => {
    const d = dist[r.cy * w + r.cx];
    if (d > best) {
      best = d;
      exitRoom = i;
    }
  });

  const torches: { x: number; y: number }[] = [];
  for (const r of rooms) {
    for (let x = r.x + 1; x < r.x + r.w - 1; x += 4) {
      if (getTile(tiles, w, h, x, r.y - 1) === WALL) torches.push({ x, y: r.y - 1 });
    }
  }

  return { w, h, tiles, rooms, startRoom, exitRoom, torches };
}

function carveRect(tiles: Uint8Array, w: number, x: number, y: number, rw: number, rh: number) {
  for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) setTile(tiles, w, i, j, FLOOR);
}

function setTile(tiles: Uint8Array, w: number, x: number, y: number, v: number) {
  if (x < 1 || y < 1 || x >= w - 1 || y >= tiles.length / w - 1) return;
  tiles[y * w + x] = v;
}

export function getTile(tiles: Uint8Array, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return WALL;
  return tiles[y * w + x];
}

/** Distances BFS (4-connexité) depuis une case ; -1 si inaccessible. */
export function bfs(tiles: Uint8Array, w: number, h: number, sx: number, sy: number): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  if (getTile(tiles, w, h, sx, sy) !== FLOOR) return dist;
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = sy * w + sx;
  dist[sy * w + sx] = 0;
  while (head < tail) {
    const c = queue[head++];
    const cx = c % w;
    const cy = (c / w) | 0;
    const d = dist[c] + 1;
    if (cx > 0) visit(c - 1);
    if (cx < w - 1) visit(c + 1);
    if (cy > 0) visit(c - w);
    if (cy < h - 1) visit(c + w);
    function visit(n: number) {
      if (dist[n] === -1 && tiles[n] === FLOOR) {
        dist[n] = d;
        queue[tail++] = n;
      }
    }
  }
  return dist;
}
