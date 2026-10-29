import * as THREE from 'three';
import { computeStats, type Character } from '../core/character';
import type { Stats } from '../core/stats';
import type { GameCtx } from './context';
import type { Enemy } from './enemies';
import type { Input } from './input';
import { animateRig, buildHumanoid, buildShadowBlob, setFlash, type Rig } from './models';

export type SkillId = 'slash' | 'fireball' | 'whirl' | 'nova' | 'meteor' | 'dash' | 'potion';

export interface SkillDef {
  id: SkillId;
  name: string;
  key: string;
  mana: number;
  /** Recharge de base en secondes (avant vitesse d'attaque / réduction). */
  cooldown: number;
  icon: string;
  description: string;
  /** Niveau du personnage requis. */
  unlock: number;
}

export const SKILLS: SkillDef[] = [
  { id: 'slash', name: 'Taille', key: 'Mouse0', mana: 0, cooldown: 0.5, icon: '⚔', unlock: 1,
    description: 'Frappe en arc devant vous. Touche tous les ennemis dans la zone.' },
  { id: 'fireball', name: 'Boule de feu', key: 'Mouse2', mana: 14, cooldown: 0.45, icon: '🔥', unlock: 1,
    description: 'Projectile qui explose au contact (180 % des dégâts en zone).' },
  { id: 'whirl', name: 'Tourbillon', key: 'Digit1', mana: 24, cooldown: 5, icon: '🌀', unlock: 2,
    description: 'Tournoie en frappant 4 fois tout autour de vous.' },
  { id: 'nova', name: 'Nova de givre', key: 'Digit2', mana: 32, cooldown: 8, icon: '❄', unlock: 4,
    description: 'Onde glaciale : 140 % des dégâts et ralentit de 60 % pendant 3 s.' },
  { id: 'meteor', name: 'Pluie de météores', key: 'Digit3', mana: 45, cooldown: 12, icon: '☄', unlock: 6,
    description: 'Six météores s’abattent autour du point visé : 220 % des dégâts chacun en zone.' },
  { id: 'dash', name: 'Roulade', key: 'Space', mana: 0, cooldown: 2.5, icon: '💨', unlock: 1,
    description: 'Bond rapide dans la direction du mouvement. Invulnérable pendant le bond.' },
  { id: 'potion', name: 'Potion', key: 'KeyF', mana: 0, cooldown: 1, icon: '🧪', unlock: 1,
    description: 'Rend 45 % de la vie sur 2 s.' },
];

export const PLAYER_RADIUS = 0.45;
const BASE_SPEED = 6.2;

export class Player {
  readonly rig: Rig;
  readonly root: THREE.Group;
  readonly pos = new THREE.Vector3();
  facing = 0;
  hp = 100;
  mana = 60;
  stats: Stats;
  dead = false;
  deadTime = 0;
  /** Cooldowns restants par compétence. */
  readonly cd: Record<SkillId, number> = { slash: 0, fireball: 0, whirl: 0, nova: 0, meteor: 0, dash: 0, potion: 0 };
  private action: { id: SkillId; t: number; dur: number; hitAt: number[]; hitsDone: number; dir: THREE.Vector3 } | null = null;
  private dash: { t: number; dir: THREE.Vector3 } | null = null;
  private healOverTime = 0;
  private flash = 0;
  private moving = 0;
  private walkTime = 0;
  invulnerable = 0;
  readonly radiusForEnemies = PLAYER_RADIUS;
  private readonly meteorTarget = new THREE.Vector3();
  /** Dernier point visé (sol), pour les sorts ciblés. */
  private readonly lastAim = new THREE.Vector3();
  readonly light: THREE.PointLight;
  private readonly slashArc: THREE.Mesh;

  constructor(public character: Character) {
    this.rig = buildHumanoid({
      skin: 0xe0b48f,
      torso: 0x7d8796,
      legs: 0x3a3430,
      accent: 0x9aa3ad,
      helm: 'helm',
      weapon: 'sword',
      shield: true,
      cape: 0x7a1e1e,
    });
    this.root = this.rig.root;
    this.root.add(buildShadowBlob(0.55));
    this.light = new THREE.PointLight(0xffc68a, 30, 18, 1.5);
    this.light.position.set(0, 3.2, 0.6);
    this.root.add(this.light);

    // Arc lumineux de la Taille.
    const arcGeo = new THREE.RingGeometry(0.9, 2.6, 24, 1, -Math.PI * 0.32, Math.PI * 0.64);
    arcGeo.rotateX(-Math.PI / 2);
    this.slashArc = new THREE.Mesh(
      arcGeo,
      new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.slashArc.position.y = 1.0;
    this.slashArc.renderOrder = 5;

    this.stats = computeStats(character);
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  attach(scene: THREE.Scene) {
    scene.add(this.root);
    scene.add(this.slashArc);
  }

  refreshStats(): void {
    const hpRatio = this.hp / this.stats.maxHp;
    const manaRatio = this.mana / this.stats.maxMana;
    this.stats = computeStats(this.character);
    this.hp = Math.min(this.stats.maxHp, Math.max(1, hpRatio * this.stats.maxHp));
    this.mana = Math.min(this.stats.maxMana, manaRatio * this.stats.maxMana);
  }

  fullHeal(): void {
    this.hp = this.stats.maxHp;
    this.mana = this.stats.maxMana;
  }

  skillCooldown(id: SkillId): number {
    const def = SKILLS.find((s) => s.id === id)!;
    if (id === 'slash' || id === 'fireball') return def.cooldown / this.stats.attackSpeed;
    if (id === 'potion') return def.cooldown;
    return def.cooldown * (1 - this.stats.cdr);
  }

  isUnlocked(id: SkillId): boolean {
    return this.character.level >= SKILLS.find((s) => s.id === id)!.unlock;
  }

  /** Dégâts tirés pour une attaque, avec critique. */
  rollDamage(ctx: GameCtx, mult: number, spell = false): { amount: number; crit: boolean } {
    const s = this.stats;
    let dmg = s.damage * (1 + s.damagePct) * mult * ctx.rng.range(0.85, 1.15);
    if (spell) dmg *= 1 + s.spellPct;
    const crit = ctx.rng.chance(s.critChance);
    if (crit) dmg *= s.critMult;
    return { amount: Math.max(1, Math.round(dmg)), crit };
  }

  hurtFlash() {
    this.flash = 1;
  }

  get busy(): boolean {
    return !!this.action || !!this.dash;
  }

  update(dt: number, ctx: GameCtx, input: Input, aim: THREE.Vector3): void {
    for (const k in this.cd) this.cd[k as SkillId] = Math.max(0, this.cd[k as SkillId] - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);

    if (this.dead) {
      this.deadTime += dt;
      animateRig(this.rig, ctx.time, { moving: 0, attack: 0, dead: this.deadTime });
      this.root.position.copy(this.pos);
      return;
    }

    // Régénération.
    this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.hpRegen * dt);
    this.mana = Math.min(this.stats.maxMana, this.mana + this.stats.manaRegen * dt);
    if (this.healOverTime > 0) {
      const h = Math.min(this.healOverTime, this.stats.maxHp * 0.225 * dt);
      this.healOverTime -= h;
      this.hp = Math.min(this.stats.maxHp, this.hp + h);
    }

    // Direction de déplacement (ZQSD/WASD + flèches), dans le repère caméra
    // (la caméra regarde vers -Z).
    const mv = new THREE.Vector3(
      (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0),
      0,
      (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0) - (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0),
    );
    if (mv.lengthSq() > 0) mv.normalize();

    this.lastAim.copy(aim);
    const toAim = new THREE.Vector3(aim.x - this.pos.x, 0, aim.z - this.pos.z);
    const aimDir = toAim.lengthSq() > 0.01 ? toAim.normalize() : new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));

    // --- Compétences -----------------------------------------------------------
    const want = (id: SkillId) => {
      const def = SKILLS.find((s) => s.id === id)!;
      if (id === 'slash') return input.mouseLeft || input.wasPressed('Mouse0');
      if (id === 'fireball') return input.mouseRight || input.wasPressed('Mouse2');
      return input.wasPressed(def.key);
    };

    if (!this.dash && want('dash') && this.cd.dash <= 0) {
      const dir = mv.lengthSq() > 0 ? mv.clone() : aimDir.clone();
      this.dash = { t: 0, dir };
      this.action = null;
      this.cd.dash = this.skillCooldown('dash');
      this.invulnerable = 0.3;
      ctx.audio.play('dash');
    }

    if (want('potion')) this.tryPotion(ctx);

    if (!this.action && !this.dash) {
      for (const id of ['meteor', 'whirl', 'nova', 'fireball', 'slash'] as SkillId[]) {
        if (!want(id)) continue;
        if (this.tryStart(id, ctx, aimDir)) break;
      }
    }

    // --- Mouvement -------------------------------------------------------------
    let speed = BASE_SPEED * this.stats.moveSpeed;
    if (this.dash) {
      this.dash.t += dt;
      const dur = 0.2;
      ctx.collision.move(this.pos, this.dash.dir.x * 30 * dt, this.dash.dir.z * 30 * dt, PLAYER_RADIUS);
      this.facing = Math.atan2(this.dash.dir.x, this.dash.dir.z);
      ctx.particles.emit({ x: this.pos.x, y: 0.4, z: this.pos.z, vy: 1, color: 0x9a8f80, size: 0.6, life: 0.4 });
      if (this.dash.t >= dur) this.dash = null;
      this.moving = 1;
    } else {
      if (this.action) speed *= this.action.id === 'whirl' ? 0.75 : 0.35;
      if (mv.lengthSq() > 0) {
        ctx.collision.move(this.pos, mv.x * speed * dt, mv.z * speed * dt, PLAYER_RADIUS);
        if (!this.action) this.facing = turnTowards(this.facing, Math.atan2(mv.x, mv.z), dt * 14);
        this.moving = Math.min(1, this.moving + dt * 8);
      } else {
        this.moving = Math.max(0, this.moving - dt * 8);
      }
    }

    // --- Action en cours ---------------------------------------------------------
    let attackPhase = 0;
    let style: 'swing' | 'cast' | 'spin' | 'thrust' = 'swing';
    if (this.action) {
      const a = this.action;
      a.t += dt;
      attackPhase = Math.min(1, a.t / a.dur);
      if (a.id !== 'whirl') this.facing = turnTowards(this.facing, Math.atan2(a.dir.x, a.dir.z), dt * 30);
      style = a.id === 'slash' ? 'swing' : a.id === 'whirl' ? 'spin' : 'cast';
      while (a.hitsDone < a.hitAt.length && a.t >= a.hitAt[a.hitsDone]) {
        this.resolve(a.id, ctx, a.dir, a.hitsDone);
        a.hitsDone++;
      }
      if (a.t >= a.dur) this.action = null;
    }

    // Arc visuel de la Taille.
    const arcMat = this.slashArc.material as THREE.MeshBasicMaterial;
    arcMat.opacity = Math.max(0, arcMat.opacity - dt * 5);
    this.slashArc.position.set(this.pos.x, 1.0, this.pos.z);

    // --- Visuel ------------------------------------------------------------------
    this.walkTime += dt * (0.6 + 0.4 * this.stats.moveSpeed);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
    animateRig(this.rig, this.walkTime, { moving: this.moving, attack: attackPhase, attackStyle: style });
    const cape = this.rig.body.getObjectByName('cape');
    if (cape) cape.rotation.x = 0.15 + this.moving * 0.35 + Math.sin(ctx.time * 6) * 0.04;
    this.flash = Math.max(0, this.flash - dt * 6);
    setFlash(this.rig, this.flash * 1.5, 0xff2222);
    this.light.intensity = 28 + Math.sin(ctx.time * 11) * 1.5 + Math.sin(ctx.time * 17) * 1;
  }

  private tryPotion(ctx: GameCtx) {
    const c = this.character;
    if (this.cd.potion > 0) return;
    if (c.potions <= 0 || this.hp >= this.stats.maxHp) {
      ctx.audio.play('error');
      ctx.floatText(this.pos, c.potions <= 0 ? 'Plus de potions' : 'Vie au maximum', 'info');
      this.cd.potion = 0.5;
      return;
    }
    c.potions--;
    this.healOverTime += this.stats.maxHp * 0.45;
    this.cd.potion = this.skillCooldown('potion');
    ctx.audio.play('potion');
    ctx.particles.burst(this.pos.clone().setY(1), 0xff4060, 24, 3, { gravity: -2, life: 0.9, up: 2 });
  }

  private tryStart(id: SkillId, ctx: GameCtx, dir: THREE.Vector3): boolean {
    if (this.cd[id] > 0) return false;
    if (!this.isUnlocked(id)) return false;
    const def = SKILLS.find((s) => s.id === id)!;
    if (this.mana < def.mana) {
      if (id !== 'fireball' || ctx.rng.chance(0.2)) {
        ctx.floatText(this.pos, 'Pas assez de mana', 'mana');
        ctx.audio.play('error');
      }
      this.cd[id] = 0.4;
      return false;
    }
    this.mana -= def.mana;
    const as = this.stats.attackSpeed;
    this.cd[id] = this.skillCooldown(id);
    switch (id) {
      case 'slash':
        this.action = { id, t: 0, dur: 0.42 / as, hitAt: [0.18 / as], hitsDone: 0, dir: dir.clone() };
        ctx.audio.play('swing');
        break;
      case 'fireball':
        this.action = { id, t: 0, dur: 0.32 / as, hitAt: [0.14 / as], hitsDone: 0, dir: dir.clone() };
        break;
      case 'whirl':
        this.action = { id, t: 0, dur: 0.8, hitAt: [0.1, 0.3, 0.5, 0.7], hitsDone: 0, dir: dir.clone() };
        ctx.audio.play('whirl');
        break;
      case 'nova':
        this.action = { id, t: 0, dur: 0.4, hitAt: [0.15], hitsDone: 0, dir: dir.clone() };
        break;
      case 'meteor':
        this.action = { id, t: 0, dur: 0.5, hitAt: [0.25], hitsDone: 0, dir: dir.clone() };
        this.meteorTarget.copy(this.lastAim);
        break;
      default:
        return false;
    }
    return true;
  }

  private resolve(id: SkillId, ctx: GameCtx, dir: THREE.Vector3, _hitIndex: number) {
    const origin = this.pos;
    switch (id) {
      case 'slash': {
        const range = 2.7;
        const cosHalf = Math.cos((65 * Math.PI) / 180);
        let hits = 0;
        for (const e of ctx.enemies) {
          if (e.dead) continue;
          const to = new THREE.Vector3(e.pos.x - origin.x, 0, e.pos.z - origin.z);
          const d = to.length() - e.radius;
          if (d > range) continue;
          to.normalize();
          if (to.dot(dir) < cosHalf && d > 0.6) continue;
          const r = this.rollDamage(ctx, 1);
          ctx.damageEnemy(e, r.amount, { crit: r.crit, knockback: 4, from: origin });
          hits++;
        }
        const arc = this.slashArc;
        arc.rotation.y = Math.atan2(-dir.z, dir.x);
        (arc.material as THREE.MeshBasicMaterial).opacity = 0.55;
        if (hits > 0) ctx.shake(0.12 + Math.min(hits, 4) * 0.04);
        ctx.hitBreakables(origin, range, dir, cosHalf);
        break;
      }
      case 'fireball': {
        const start = origin.clone().add(dir.clone().multiplyScalar(0.8)).setY(1.2);
        const r = this.rollDamage(ctx, 1.8, true);
        ctx.spawnProjectile({
          kind: 'fireball',
          owner: 'player',
          pos: start,
          vel: dir.clone().multiplyScalar(17),
          damage: r.amount,
          crit: r.crit,
          radius: 0.35,
          aoe: 2.4,
          life: 1.4,
        });
        ctx.audio.play('fireball');
        break;
      }
      case 'whirl': {
        const range = 3.1;
        for (const e of ctx.enemies) {
          if (e.dead) continue;
          if (e.pos.distanceTo(origin) - e.radius > range) continue;
          const r = this.rollDamage(ctx, 0.75);
          ctx.damageEnemy(e, r.amount, { crit: r.crit, knockback: 2.5, from: origin });
        }
        ctx.particles.ring(origin, 1.2, 0xffe2b0, 28, { speed: 9, size: 0.35, life: 0.3, y: 0.9 });
        ctx.hitBreakables(origin, range);
        ctx.shake(0.1);
        break;
      }
      case 'nova': {
        const range = 6.5;
        for (const e of ctx.enemies) {
          if (e.dead) continue;
          if (e.pos.distanceTo(origin) - e.radius > range) continue;
          const r = this.rollDamage(ctx, 1.4, true);
          ctx.damageEnemy(e, r.amount, { crit: r.crit, knockback: 3, from: origin, slow: 0.6, slowFor: 3, spell: true, color: 0x88ccff });
        }
        ctx.particles.ring(origin, 0.6, 0x9fdcff, 90, { speed: 14, size: 0.55, life: 0.55 });
        ctx.hitBreakables(origin, range);
        ctx.particles.burst(origin.clone().setY(0.5), 0xe0f4ff, 40, 6, { gravity: 2, life: 0.8 });
        ctx.audio.play('nova');
        ctx.shake(0.25);
        break;
      }
      case 'meteor': {
        const center = this.meteorTarget.clone();
        // Limite la portée à 12 m.
        const off = center.clone().sub(origin).setY(0);
        if (off.length() > 12) center.copy(origin).add(off.setLength(12));
        for (let i = 0; i < 6; i++) {
          const a = ctx.rng.range(0, Math.PI * 2);
          const r = i === 0 ? 0 : ctx.rng.range(1.2, 3.6);
          const at = center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)).setY(0);
          if (!ctx.collision.isWalkable(at.x, at.z)) continue;
          const roll = this.rollDamage(ctx, 2.2, true);
          ctx.addTelegraph(at, 1.9, 0.45 + i * 0.12, () => {
            ctx.particles.burst(at.clone().setY(0.4), 0xff6a1a, 34, 8, { size: 0.55, life: 0.55, gravity: 6 });
            ctx.particles.ring(at, 0.4, 0xffb060, 26, { speed: 8, size: 0.45, life: 0.4 });
            ctx.audio.play('explode');
            ctx.shake(0.22);
            for (const e of ctx.enemies) {
              if (e.dead) continue;
              if (Math.hypot(e.pos.x - at.x, e.pos.z - at.z) - e.radius < 1.9) ctx.damageEnemy(e, roll.amount, { crit: roll.crit, knockback: 3, from: at, spell: true, color: 0xff7a1a });
            }
            ctx.hitBreakables(at, 1.9);
          }, 0xff8a2a);
        }
        ctx.audio.play('fireball');
        break;
      }
      default:
        break;
    }
  }

  /** Appelé quand un coup de mêlée du joueur touche (vie par coup). */
  onMeleeHit(): void {
    if (this.stats.lifeOnHit > 0) this.hp = Math.min(this.stats.maxHp, this.hp + this.stats.lifeOnHit);
  }

  /** Ennemi le plus proche sous le curseur, utilisé pour l'aide à la visée. */
  static pickTarget(enemies: Enemy[], aim: THREE.Vector3): Enemy | null {
    let best: Enemy | null = null;
    let bestD = 1.6;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - aim.x, e.pos.z - aim.z) - e.radius;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }
}

function turnTowards(cur: number, target: number, maxStep: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}
