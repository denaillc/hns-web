import type * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { FlowField } from '../core/flowfield';
import type { Audio } from './audio';
import type { Particles } from './particles';
import type { Collision } from './world';
import type { Enemy, EnemyKind } from './enemies';
import type { Player } from './player';
import type { ProjectileSpec } from './projectiles';

export type FloatKind = 'dmg' | 'crit' | 'player' | 'heal' | 'xp' | 'gold' | 'info' | 'mana';

export interface HitOptions {
  crit?: boolean;
  knockback?: number;
  from?: THREE.Vector3;
  /** Ralentissement (0..1) appliqué pendant `slowFor` secondes. */
  slow?: number;
  slowFor?: number;
  /** Les dégâts de sort ne déclenchent pas la vie par coup. */
  spell?: boolean;
  color?: number;
}

/** Ce que les entités peuvent demander au jeu. */
export interface GameCtx {
  scene: THREE.Scene;
  particles: Particles;
  audio: Audio;
  collision: Collision;
  flow: FlowField;
  rng: Rng;
  player: Player;
  enemies: Enemy[];
  time: number;
  floor: number;
  damagePlayer(amount: number, from: THREE.Vector3): void;
  damageEnemy(e: Enemy, amount: number, opts?: HitOptions): void;
  spawnProjectile(p: ProjectileSpec): void;
  addTelegraph(pos: THREE.Vector3, radius: number, duration: number, onFire: () => void, color?: number): void;
  spawnEnemy(kind: EnemyKind, pos: THREE.Vector3, elite?: boolean): Enemy | null;
  shake(amount: number): void;
  floatText(pos: THREE.Vector3, text: string, kind: FloatKind): void;
}
