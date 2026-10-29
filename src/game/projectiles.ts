import * as THREE from 'three';
import type { GameCtx } from './context';
import { PLAYER_RADIUS } from './player';

export type ProjectileKind = 'fireball' | 'arrow' | 'bolt';

export interface ProjectileSpec {
  kind: ProjectileKind;
  owner: 'player' | 'enemy';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  radius: number;
  life: number;
  crit?: boolean;
  /** Rayon d'explosion (0 = pas d'explosion). */
  aoe?: number;
  /** Force de guidage vers le joueur (projectiles ennemis). */
  homing?: number;
}

interface Projectile extends ProjectileSpec {
  mesh: THREE.Object3D;
  dead: boolean;
  age: number;
}

const COLORS: Record<ProjectileKind, number> = { fireball: 0xff7a1a, arrow: 0xd9c7a0, bolt: 0xb46bff };

export class Projectiles {
  private list: Projectile[] = [];
  private readonly geo = {
    fireball: new THREE.IcosahedronGeometry(0.32, 1),
    arrow: new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4).rotateX(Math.PI / 2),
    bolt: new THREE.IcosahedronGeometry(0.28, 0),
  };
  private readonly mats = {
    fireball: new THREE.MeshBasicMaterial({ color: 0xffc46a }),
    arrow: new THREE.MeshBasicMaterial({ color: 0xd9c7a0 }),
    bolt: new THREE.MeshBasicMaterial({ color: 0xd8a8ff }),
  };
  /** Lumières mutualisées pour les projectiles lumineux (coût GPU borné). */
  private readonly lights: THREE.PointLight[] = [];

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 8, 2);
      scene.add(l);
      this.lights.push(l);
    }
  }

  spawn(spec: ProjectileSpec): void {
    const mesh = new THREE.Mesh(this.geo[spec.kind], this.mats[spec.kind]);
    mesh.position.copy(spec.pos);
    if (spec.kind === 'arrow') mesh.lookAt(spec.pos.clone().add(spec.vel));
    this.scene.add(mesh);
    this.list.push({ ...spec, pos: spec.pos.clone(), vel: spec.vel.clone(), mesh, dead: false, age: 0 });
  }

  update(dt: number, ctx: GameCtx): void {
    for (const p of this.list) {
      if (p.dead) continue;
      p.age += dt;
      p.life -= dt;
      if (p.homing && p.owner === 'enemy' && !ctx.player.dead) {
        const to = ctx.player.pos.clone().setY(p.pos.y).sub(p.pos).normalize();
        const speed = p.vel.length();
        p.vel.addScaledVector(to, p.homing * speed * dt).setLength(speed);
      }
      const prev = p.pos.clone();
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.kind !== 'arrow') p.mesh.rotation.set(p.age * 7, p.age * 5, 0);

      // Traînée.
      const c = COLORS[p.kind];
      if (p.kind === 'fireball') {
        for (let i = 0; i < 3; i++)
          ctx.particles.emit({
            x: p.pos.x + (Math.random() - 0.5) * 0.3,
            y: p.pos.y + (Math.random() - 0.5) * 0.3,
            z: p.pos.z + (Math.random() - 0.5) * 0.3,
            vy: 1.2,
            color: i === 0 ? 0xffd27a : c,
            size: 0.55,
            life: 0.35,
          });
      } else if (p.kind === 'bolt') {
        ctx.particles.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, color: c, size: 0.45, life: 0.3 });
      }

      // Murs.
      if (!ctx.collision.isWalkable(p.pos.x, p.pos.z)) {
        this.impact(p, ctx, prev);
        continue;
      }
      if (p.life <= 0) {
        if (p.aoe) this.impact(p, ctx, p.pos);
        else p.dead = true;
        continue;
      }

      // Cibles.
      if (p.owner === 'player') {
        for (const e of ctx.enemies) {
          if (e.dead) continue;
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          if (dx * dx + dz * dz < (e.radius + p.radius) ** 2) {
            if (!p.aoe) ctx.damageEnemy(e, p.damage, { crit: p.crit, knockback: 2, from: prev, spell: true });
            this.impact(p, ctx, p.pos);
            break;
          }
        }
      } else if (!ctx.player.dead) {
        const dx = ctx.player.pos.x - p.pos.x;
        const dz = ctx.player.pos.z - p.pos.z;
        if (dx * dx + dz * dz < (PLAYER_RADIUS + p.radius) ** 2) {
          ctx.damagePlayer(p.damage, prev);
          this.impact(p, ctx, p.pos);
        }
      }
    }

    // Lumières sur les premiers projectiles lumineux.
    const glowing = this.list.filter((p) => !p.dead && p.kind !== 'arrow');
    this.lights.forEach((l, i) => {
      const p = glowing[i];
      if (p) {
        l.position.copy(p.pos);
        l.color.setHex(p.kind === 'fireball' ? 0xff8a3a : 0xb46bff);
        l.intensity = p.kind === 'fireball' ? 14 : 6;
      } else l.intensity = 0;
    });

    this.list = this.list.filter((p) => {
      if (p.dead) this.scene.remove(p.mesh);
      return !p.dead;
    });
  }

  private impact(p: Projectile, ctx: GameCtx, at: THREE.Vector3) {
    p.dead = true;
    if (p.aoe) {
      ctx.particles.burst(at, 0xff8a2a, 40, 7, { size: 0.5, life: 0.5, gravity: 3 });
      ctx.particles.burst(at, 0xffe08a, 20, 4, { size: 0.7, life: 0.3, gravity: 0 });
      ctx.audio.play('explode');
      ctx.shake(0.18);
      if (p.owner === 'player') ctx.hitBreakables(at, p.aoe);
      for (const e of ctx.enemies) {
        if (e.dead) continue;
        if (e.pos.distanceTo(at.clone().setY(0)) - e.radius < p.aoe) {
          ctx.damageEnemy(e, p.damage, { crit: p.crit, knockback: 4, from: at, spell: true, color: 0xff7a1a });
        }
      }
    } else {
      ctx.particles.burst(at, COLORS[p.kind], 10, 3, { size: 0.25, life: 0.3 });
    }
  }

  clear(): void {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list = [];
    for (const l of this.lights) l.intensity = 0;
  }
}

// ---------------------------------------------------------------------------
// Télégraphes : zones d'impact affichées au sol avant une attaque.
// ---------------------------------------------------------------------------

interface Telegraph {
  mesh: THREE.Mesh;
  fill: THREE.Mesh;
  t: number;
  dur: number;
  onFire: () => void;
}

export class Telegraphs {
  private list: Telegraph[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
  private readonly diskGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);

  constructor(private readonly scene: THREE.Scene) {}

  add(pos: THREE.Vector3, radius: number, dur: number, onFire: () => void, color = 0xff3322) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(pos.x, 0.05, pos.z);
    mesh.scale.setScalar(radius);
    const fillMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false });
    const fill = new THREE.Mesh(this.diskGeo, fillMat);
    fill.position.set(pos.x, 0.04, pos.z);
    fill.scale.setScalar(0.01);
    mesh.renderOrder = fill.renderOrder = 2;
    this.scene.add(mesh, fill);
    this.list.push({ mesh, fill, t: 0, dur, onFire });
  }

  update(dt: number) {
    for (const t of this.list) {
      t.t += dt;
      const k = Math.min(1, t.t / t.dur);
      t.fill.scale.setScalar(Math.max(0.01, k * t.mesh.scale.x));
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(t.t * 20) ** 2;
      if (t.t >= t.dur) t.onFire();
    }
    this.list = this.list.filter((t) => {
      if (t.t >= t.dur) {
        this.scene.remove(t.mesh, t.fill);
        (t.mesh.material as THREE.Material).dispose();
        (t.fill.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  clear() {
    for (const t of this.list) this.scene.remove(t.mesh, t.fill);
    this.list = [];
  }
}
