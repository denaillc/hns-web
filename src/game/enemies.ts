import * as THREE from 'three';
import { monsterScaling } from '../core/stats';
import type { GameCtx } from './context';
import { animateRig, buildBat, buildHumanoid, buildShadowBlob, setFlash, type Rig } from './models';
import { toTile, TILE } from './world';

export type EnemyKind = 'skeleton' | 'archer' | 'brute' | 'bat' | 'necro' | 'boss';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  damage: number;
  speed: number;
  radius: number;
  xp: number;
  /** Portée à partir de laquelle l'ennemi commence son attaque. */
  attackRange: number;
  windup: number;
  recover: number;
  ranged?: boolean;
  /** Distance que les unités à distance cherchent à garder. */
  keepAway?: number;
  /** Poids de l'ennemi pour la répulsion / knockback. */
  mass: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  skeleton: { kind: 'skeleton', name: 'Squelette', hp: 34, damage: 9, speed: 3.6, radius: 0.45, xp: 12, attackRange: 1.5, windup: 0.4, recover: 0.6, mass: 1 },
  archer: { kind: 'archer', name: 'Archer squelette', hp: 24, damage: 8, speed: 3.2, radius: 0.42, xp: 14, attackRange: 12, windup: 0.6, recover: 1.1, ranged: true, keepAway: 7, mass: 0.9 },
  brute: { kind: 'brute', name: 'Goule massive', hp: 130, damage: 24, speed: 2.6, radius: 0.85, xp: 40, attackRange: 2.4, windup: 0.85, recover: 0.9, mass: 3 },
  bat: { kind: 'bat', name: 'Chauve-souris des cryptes', hp: 13, damage: 5, speed: 6.4, radius: 0.35, xp: 6, attackRange: 1.2, windup: 0.18, recover: 0.7, mass: 0.4 },
  necro: { kind: 'necro', name: 'Nécromancien', hp: 46, damage: 11, speed: 2.8, radius: 0.45, xp: 30, attackRange: 11, windup: 0.8, recover: 1.4, ranged: true, keepAway: 8, mass: 1 },
  boss: { kind: 'boss', name: 'Morvhal, le Roi-Liche', hp: 1100, damage: 30, speed: 3.0, radius: 1.3, xp: 450, attackRange: 3.4, windup: 0.7, recover: 0.8, mass: 50 },
};

type State = 'idle' | 'chase' | 'windup' | 'recover' | 'dead';

let nextId = 1;

export class Enemy {
  readonly id = nextId++;
  readonly def: EnemyDef;
  readonly rig: Rig & { wings?: THREE.Object3D[] };
  readonly root: THREE.Group;
  readonly pos: THREE.Vector3;
  readonly vel = new THREE.Vector3();
  hp: number;
  maxHp: number;
  damage: number;
  xp: number;
  radius: number;
  elite: boolean;
  name: string;
  state: State = 'idle';
  stateTime = 0;
  facing = Math.random() * Math.PI * 2;
  aggro = false;
  slowUntil = 0;
  slowAmount = 0;
  flash = 0;
  dead = false;
  deadTime = 0;
  /** Supprimé de la scène après l'animation de mort. */
  removed = false;
  lastHitAt = -10;
  alertedByPack = false;
  private walkT = Math.random() * 10;
  private attackCount = 0;
  private strafeDir = Math.random() < 0.5 ? -1 : 1;
  private bossPhase = 0;
  private bossSpecialCd = 4;
  private eliteRing: THREE.Mesh | null = null;

  constructor(kind: EnemyKind, pos: THREE.Vector3, floor: number, elite = false) {
    this.def = ENEMY_DEFS[kind];
    const sc = monsterScaling(floor);
    this.elite = elite;
    this.maxHp = this.hp = Math.round(this.def.hp * sc.hp * (elite ? 2.8 : 1));
    this.damage = this.def.damage * sc.damage * (elite ? 1.35 : 1);
    this.xp = Math.round(this.def.xp * sc.xp * (elite ? 3 : 1));
    this.radius = this.def.radius * (elite ? 1.15 : 1);
    this.name = elite ? `${this.def.name} champion` : this.def.name;
    this.pos = pos.clone();
    this.rig = makeRig(kind);
    this.root = this.rig.root;
    if (elite) {
      this.root.scale.multiplyScalar(1.15);
      for (const m of this.rig.flashMaterials) m.color.lerp(new THREE.Color(0x6688ff), 0.25);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(this.def.radius * 1.1, this.def.radius * 1.35, 24),
        new THREE.MeshBasicMaterial({ color: 0x5a7cff, transparent: true, opacity: 0.7, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      this.root.add(ring);
      this.eliteRing = ring;
    }
    this.root.add(buildShadowBlob(this.def.radius * 1.1));
    this.root.position.copy(this.pos);
    if (kind === 'boss') this.aggro = false;
  }

  get kind(): EnemyKind {
    return this.def.kind;
  }

  get isBoss(): boolean {
    return this.def.kind === 'boss';
  }

  speedMult(time: number): number {
    return time < this.slowUntil ? 1 - this.slowAmount : 1;
  }

  update(dt: number, ctx: GameCtx): void {
    this.stateTime += dt;
    this.flash = Math.max(0, this.flash - dt * 7);
    const slowed = ctx.time < this.slowUntil;
    setFlash(this.rig, this.flash * 1.4, 0xffffff);
    if (slowed && this.flash <= 0.05) setFlash(this.rig, 0.6, 0x3388ff);
    if (this.eliteRing) this.eliteRing.rotation.z += dt;

    if (this.dead) {
      this.deadTime += dt;
      if (this.kind === 'bat') {
        this.pos.y = Math.max(0, this.pos.y - dt * 4);
        this.root.position.copy(this.pos);
        this.root.rotation.z = this.deadTime * 6;
      } else animateRig(this.rig, this.walkT, { moving: 0, attack: 0, dead: this.deadTime });
      // Les corps s'enfoncent dans le sol puis disparaissent.
      if (this.deadTime > 2.2) this.root.position.y = -(this.deadTime - 2.2) * 1.2;
      if (this.deadTime > 3.2) this.removed = true;
      return;
    }

    const player = ctx.player;
    const toPlayer = new THREE.Vector3(player.pos.x - this.pos.x, 0, player.pos.z - this.pos.z);
    const dist = toPlayer.length();
    const dirToPlayer = dist > 0.001 ? toPlayer.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);

    // Détection du joueur.
    if (!this.aggro && !player.dead) {
      const sight = this.isBoss ? 14 : 13;
      if (dist < sight && ctx.collision.lineOfSight(this.pos, player.pos)) this.aggro = true;
      if (dist < 4) this.aggro = true;
    }
    if (player.dead) this.aggro = false;


    const sp = this.def.speed * this.speedMult(ctx.time);
    let moving = 0;
    let attackPhase = 0;
    let style: 'swing' | 'thrust' | 'cast' | 'spin' = this.def.ranged ? 'cast' : this.kind === 'brute' ? 'swing' : 'thrust';
    const desired = new THREE.Vector3();

    switch (this.state) {
      case 'idle': {
        // Errance légère.
        if (Math.random() < dt * 0.4) this.facing += (Math.random() - 0.5) * 2;
        if (this.aggro) {
          // Les monstres proches se réveillent ensemble (meute), sans propagation en chaîne.
          if (!this.alertedByPack)
            for (const o of ctx.enemies)
              if (!o.aggro && !o.dead && o.pos.distanceTo(this.pos) < 8) {
                o.aggro = true;
                o.alertedByPack = true;
              }
          this.setState('chase');
        }
        break;
      }
      case 'chase': {
        if (!this.aggro) {
          this.setState('idle');
          break;
        }
        const los = dist < 16 && ctx.collision.lineOfSight(this.pos, player.pos);
        const inRange = dist - player.radiusForEnemies < this.def.attackRange;
        if (inRange && (los || !this.def.ranged) && this.stateTime > 0.15) {
          this.setState('windup');
          this.onWindupStart(ctx);
          break;
        }
        if (this.def.ranged && los && dist < (this.def.keepAway ?? 6)) {
          // Recule en tournant autour du joueur.
          desired.copy(dirToPlayer).multiplyScalar(-1).add(new THREE.Vector3(-dirToPlayer.z, 0, dirToPlayer.x).multiplyScalar(this.strafeDir * 0.7));
        } else if (los && dist < 10) {
          desired.copy(dirToPlayer);
        } else {
          // Suit le champ de flux pour contourner les murs.
          const tx = toTile(this.pos.x);
          const ty = toTile(this.pos.z);
          const next = ctx.flow.next(tx, ty);
          if (next) {
            desired.set(next[0] * TILE + TILE / 2 - this.pos.x, 0, next[1] * TILE + TILE / 2 - this.pos.z);
          } else if (ctx.flow.distanceAt(tx, ty) === Infinity) {
            // Hors de portée du champ : abandon de la poursuite.
            this.aggro = false;
          } else desired.copy(dirToPlayer);
        }
        if (desired.lengthSq() > 0) desired.normalize();
        moving = 1;
        break;
      }
      case 'windup': {
        if (!this.isBoss || this.bossAttack !== 'slam') this.facing = turnTo(this.facing, Math.atan2(dirToPlayer.x, dirToPlayer.z), dt * 8);
        attackPhase = Math.min(0.35, (this.stateTime / this.def.windup) * 0.35);
        if (this.stateTime >= this.def.windup) {
          this.executeAttack(ctx, dist, dirToPlayer);
          this.setState('recover');
        }
        break;
      }
      case 'recover': {
        attackPhase = 0.35 + Math.min(0.65, (this.stateTime / 0.3) * 0.65);
        if (this.isBoss && this.bossAttack === 'nova') style = 'cast';
        if (this.stateTime >= this.def.recover) this.setState('chase');
        break;
      }
    }

    // Séparation entre ennemis.
    for (const o of ctx.enemies) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x;
      const dz = this.pos.z - o.pos.z;
      const min = this.radius + o.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * (o.def.mass / (o.def.mass + this.def.mass));
        desired.x += dx * push * 2;
        desired.z += dz * push * 2;
      }
    }
    // Ne pas entrer dans le joueur.
    if (dist < this.radius + 0.5) desired.addScaledVector(dirToPlayer, -1.5);

    // Intégration (vitesse désirée + impulsion de knockback).
    const vx = desired.x * sp + this.vel.x;
    const vz = desired.z * sp + this.vel.z;
    ctx.collision.move(this.pos, vx * dt, vz * dt, this.radius * 0.85);
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 9));

    if (moving && desired.lengthSq() > 0.01 && this.state === 'chase') {
      const look = this.def.ranged && dist < 14 ? dirToPlayer : desired;
      this.facing = turnTo(this.facing, Math.atan2(look.x, look.z), dt * 9);
    }

    // Visuel.
    this.walkT += dt * (moving ? sp / 3.6 : 0.3);
    this.root.position.set(this.pos.x, 0, this.pos.z);
    this.root.rotation.y = this.facing;
    if (this.kind === 'bat' && this.rig.wings) {
      const flap = Math.sin(ctx.time * 22 + this.id) * 0.8;
      this.rig.wings[0].rotation.z = flap;
      this.rig.wings[1].rotation.z = -flap;
      this.rig.body.position.y = Math.sin(ctx.time * 3 + this.id) * 0.15 + (this.state === 'windup' ? -0.5 : 0);
    } else {
      animateRig(this.rig, this.walkT, { moving, attack: attackPhase, attackStyle: style });
    }

    if (this.isBoss) this.updateBoss(dt, ctx);
  }

  private setState(s: State) {
    this.state = s;
    this.stateTime = 0;
  }

  // --- Attaques --------------------------------------------------------------

  private bossAttack: 'melee' | 'slam' | 'nova' | 'summon' = 'melee';

  private onWindupStart(ctx: GameCtx) {
    this.attackCount++;
    if (this.kind === 'brute') {
      // Télégraphe : la zone d'impact apparaît au sol.
      const at = this.pos.clone().add(new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)).multiplyScalar(1.6));
      ctx.addTelegraph(at, 2.0, this.def.windup, () => {}, 0xff5533);
    }
    if (this.isBoss) {
      this.bossAttack = 'melee';
      if (this.bossSpecialCd <= 0) {
        const roll = ctx.rng.next();
        this.bossAttack = roll < 0.5 ? 'slam' : 'nova';
        this.bossSpecialCd = this.bossPhase >= 1 ? 3.5 : 5;
      }
      if (this.bossAttack === 'slam') {
        const at = ctx.player.pos.clone();
        const r = 3.6;
        this.stateTime = -0.6; // Windup plus long pour laisser le temps d'esquiver.
        ctx.addTelegraph(at, r, this.def.windup + 0.6, () => {
          ctx.particles.ring(at, 0.5, 0xb070ff, 60, { speed: 12, size: 0.6, life: 0.5 });
          ctx.particles.burst(at.clone().setY(0.3), 0x8a6a50, 40, 7, { life: 0.8 });
          ctx.audio.play('slam');
          ctx.shake(0.6);
          if (ctx.player.pos.distanceTo(at) < r + 0.3) ctx.damagePlayer(this.damage * 1.6, at);
        }, 0xb070ff);
      }
    }
  }

  private executeAttack(ctx: GameCtx, dist: number, dir: THREE.Vector3) {
    const p = ctx.player;
    const facingDir = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    switch (this.kind) {
      case 'skeleton':
      case 'bat':
        if (dist - 0.5 < this.def.attackRange + 0.4 && facingDir.dot(dir) > 0.3) ctx.damagePlayer(this.damage, this.pos);
        else ctx.audio.play('swing');
        if (this.kind === 'bat') this.vel.addScaledVector(dir, 6);
        break;
      case 'brute': {
        const at = this.pos.clone().add(facingDir.clone().multiplyScalar(1.6));
        ctx.particles.burst(at.clone().setY(0.2), 0x8a7a60, 24, 5, { life: 0.6 });
        ctx.audio.play('slam');
        ctx.shake(0.3);
        if (p.pos.distanceTo(at) < 2.3) ctx.damagePlayer(this.damage, this.pos);
        break;
      }
      case 'archer': {
        const start = this.pos.clone().setY(1.4);
        const lead = p.pos.clone().setY(1.2);
        const v = lead.sub(start).setY(0).normalize().multiplyScalar(15);
        ctx.spawnProjectile({ kind: 'arrow', owner: 'enemy', pos: start, vel: v, damage: this.damage, radius: 0.25, life: 1.6 });
        ctx.audio.play('arrow');
        break;
      }
      case 'necro': {
        if (this.attackCount % 3 === 0 && ctx.enemies.filter((e) => !e.dead).length < 40) {
          // Invocation de squelettes.
          for (let i = 0; i < 2; i++) {
            const a = ctx.rng.range(0, Math.PI * 2);
            const at = this.pos.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(1.8));
            if (!ctx.collision.isWalkable(at.x, at.z)) continue;
            const s = ctx.spawnEnemy('skeleton', at);
            if (s) {
              s.aggro = true;
              s.xp = Math.round(s.xp * 0.3);
              ctx.particles.ring(at, 0.3, 0x66ff99, 20, { speed: 3, life: 0.6 });
            }
          }
        } else {
          const start = this.pos.clone().setY(1.5);
          const v = p.pos.clone().setY(1.2).sub(start).setY(0).normalize().multiplyScalar(9);
          ctx.spawnProjectile({ kind: 'bolt', owner: 'enemy', pos: start, vel: v, damage: this.damage, radius: 0.35, life: 2.2, homing: 1.2 });
        }
        break;
      }
      case 'boss':
        this.executeBoss(ctx, dist, dir, facingDir);
        break;
    }
  }

  private executeBoss(ctx: GameCtx, dist: number, dir: THREE.Vector3, facingDir: THREE.Vector3) {
    switch (this.bossAttack) {
      case 'melee': {
        const at = this.pos.clone().add(facingDir.clone().multiplyScalar(2));
        ctx.particles.burst(at.clone().setY(0.8), 0xc9a0ff, 30, 6, { life: 0.4 });
        ctx.audio.play('slam');
        ctx.shake(0.25);
        if (dist < this.def.attackRange + 1 && facingDir.dot(dir) > 0.2) ctx.damagePlayer(this.damage, this.pos);
        break;
      }
      case 'slam':
        // Géré par le télégraphe.
        break;
      case 'nova': {
        const n = this.bossPhase >= 1 ? 18 : 12;
        const off = ctx.rng.range(0, Math.PI);
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2;
          const v = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(8);
          ctx.spawnProjectile({ kind: 'bolt', owner: 'enemy', pos: this.pos.clone().setY(1.3), vel: v, damage: this.damage * 0.6, radius: 0.4, life: 3 });
        }
        ctx.audio.play('nova');
        break;
      }
      case 'summon':
        break;
    }
  }

  private updateBoss(dt: number, ctx: GameCtx) {
    if (!this.aggro) return;
    this.bossSpecialCd -= dt;
    const ratio = this.hp / this.maxHp;
    // Invocations à 66 % et 33 %.
    const thresholds = [0.66, 0.33];
    if (this.bossPhase < thresholds.length && ratio < thresholds[this.bossPhase]) {
      this.bossPhase++;
      ctx.floatText(this.pos.clone().setY(3.5), 'Levez-vous, mes serviteurs !', 'info');
      ctx.audio.play('portal');
      for (let i = 0; i < 4 + this.bossPhase; i++) {
        const a = (i / (4 + this.bossPhase)) * Math.PI * 2;
        const at = this.pos.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(3.5));
        if (!ctx.collision.isWalkable(at.x, at.z)) continue;
        const e = ctx.spawnEnemy(i % 3 === 0 ? 'archer' : 'skeleton', at);
        if (e) {
          e.aggro = true;
          e.xp = Math.round(e.xp * 0.3);
          ctx.particles.ring(at, 0.3, 0xb070ff, 24, { speed: 3, life: 0.6 });
        }
      }
    }
  }

  /** Applique un coup reçu (appelé par le jeu). */
  takeHit(amount: number, from: THREE.Vector3 | undefined, knockback: number, time: number) {
    this.hp -= amount;
    this.flash = 1;
    this.lastHitAt = time;
    this.aggro = true;
    if (from && knockback > 0) {
      const d = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z);
      if (d.lengthSq() > 0) this.vel.addScaledVector(d.normalize(), knockback / this.def.mass);
    }
    // Les petits ennemis sont interrompus par les coups (sauf boss/brute).
    if (this.state === 'windup' && this.def.mass < 1.5 && amount > this.maxHp * 0.25 && this.kind !== 'bat') this.setState('recover');
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.state = 'dead';
    }
  }
}

function makeRig(kind: EnemyKind): Rig & { wings?: THREE.Object3D[] } {
  switch (kind) {
    case 'skeleton':
      return buildHumanoid({ skin: 0xd8cfb6, torso: 0xcfc6ab, legs: 0xcabf9f, bony: true, eyes: 0xff4422, weapon: 'sword', shield: Math.random() < 0.4, accent: 0x5a3a2a });
    case 'archer':
      return buildHumanoid({ skin: 0xd2c8ac, torso: 0x4c5a3a, legs: 0xc4b896, bony: true, eyes: 0xffcc33, weapon: 'bow', helm: 'hood', accent: 0x3a4a2c });
    case 'brute': {
      const r = buildHumanoid({ skin: 0x7c8f62, torso: 0x5f4a3c, legs: 0x4a3b2e, eyes: 0xffee55, weapon: 'club', helm: 'horns', accent: 0x6a5a48, scale: 1.55 });
      return r;
    }
    case 'bat':
      return buildBat();
    case 'necro':
      return buildHumanoid({ skin: 0xb9b0a0, torso: 0x2c2238, legs: 0x221a2c, eyes: 0x66ff99, weapon: 'staff', helm: 'hood', accent: 0x3a2b4a, cape: 0x2a1d36 });
    case 'boss':
      return buildHumanoid({ skin: 0xd9d0bb, torso: 0x3a2c4c, legs: 0x2a2236, bony: true, eyes: 0xc07aff, weapon: 'axe', helm: 'crown', accent: 0xd6a531, cape: 0x4a1f5c, scale: 2.3 });
  }
}

function turnTo(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
