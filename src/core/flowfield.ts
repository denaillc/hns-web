import { FLOOR } from './dungeon';

const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Champ de flux vers une cible (le joueur) : chaque case connaît sa distance
 * à la cible. Les ennemis descendent le gradient pour contourner les murs.
 * Recalculé quelques fois par seconde, ~4 000 cases : négligeable.
 */
export class FlowField {
  readonly dist: Float32Array;
  private readonly queue: Int32Array;
  private readonly inQueue: Uint8Array;
  targetX = -1;
  targetY = -1;

  constructor(
    readonly tiles: Uint8Array,
    readonly w: number,
    readonly h: number,
    /** Distance max explorée (en cases) : au-delà, les ennemis ne poursuivent pas. */
    readonly maxDist = 40,
  ) {
    this.dist = new Float32Array(w * h);
    this.queue = new Int32Array(w * h * 4);
    this.inQueue = new Uint8Array(w * h);
  }

  private walkable(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.tiles[y * this.w + x] === FLOOR;
  }

  /** Recalcule le champ depuis la case (tx, ty). Dijkstra approché via file SPFA. */
  compute(tx: number, ty: number): void {
    const { w, dist } = this;
    dist.fill(Infinity);
    this.targetX = tx;
    this.targetY = ty;
    if (!this.walkable(tx, ty)) return;
    const q = this.queue;
    const cap = q.length;
    let head = 0;
    let tail = 0;
    dist[ty * w + tx] = 0;
    q[tail++] = ty * w + tx;
    this.inQueue.fill(0);
    while (head !== tail) {
      const c = q[head];
      head = (head + 1) % cap;
      this.inQueue[c] = 0;
      const cx = c % w;
      const cy = (c / w) | 0;
      const base = dist[c];
      if (base > this.maxDist) continue;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!this.walkable(nx, ny)) continue;
        const diag = dx !== 0 && dy !== 0;
        // Pas de coupe de coin à travers les murs.
        if (diag && (!this.walkable(cx + dx, cy) || !this.walkable(cx, cy + dy))) continue;
        const n = ny * w + nx;
        const nd = base + (diag ? 1.4142 : 1);
        if (nd < dist[n]) {
          dist[n] = nd;
          if (!this.inQueue[n]) {
            this.inQueue[n] = 1;
            q[tail] = n;
            tail = (tail + 1) % cap;
          }
        }
      }
    }
  }

  /** Distance (en cases) depuis la case donnée ; Infinity si hors de portée. */
  distanceAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return Infinity;
    return this.dist[y * this.w + x];
  }

  /**
   * Case voisine à viser pour se rapprocher de la cible, ou null si on est déjà
   * sur la case cible ou hors du champ.
   */
  next(x: number, y: number): [number, number] | null {
    const here = this.distanceAt(x, y);
    if (here === 0 || here === Infinity) return null;
    let best = here;
    let bx = -1;
    let by = -1;
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (dx !== 0 && dy !== 0 && (!this.walkable(x + dx, y) || !this.walkable(x, y + dy))) continue;
      const d = this.distanceAt(nx, ny);
      if (d < best) {
        best = d;
        bx = nx;
        by = ny;
      }
    }
    return bx < 0 ? null : [bx, by];
  }
}
