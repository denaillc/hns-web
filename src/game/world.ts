import * as THREE from 'three';
import { FLOOR, type Dungeon } from '../core/dungeon';
import { Rng } from '../core/rng';

export const TILE = 2;
export const WALL_H = 2.6;

export function tileCenter(tx: number, ty: number): THREE.Vector3 {
  return new THREE.Vector3(tx * TILE + TILE / 2, 0, ty * TILE + TILE / 2);
}

export function toTile(v: number): number {
  return Math.floor(v / TILE);
}

// ---------------------------------------------------------------------------
// Textures procédurales (canvas) : dalles de pierre et briques.
// ---------------------------------------------------------------------------

function noiseCanvas(size: number, draw: (ctx: CanvasRenderingContext2D, rng: Rng) => void, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, new Rng(seed));
  // Grain.
  const img = ctx.getImageData(0, 0, size, size);
  const rng = new Rng(seed + 1);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function floorTexture(): THREE.Texture {
  const c = noiseCanvas(256, (ctx, rng) => {
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(0, 0, 256, 256);
    const n = 2;
    const s = 256 / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = 70 + rng.int(-12, 14);
        ctx.fillStyle = `rgb(${v + 6},${v},${v - 8})`;
        ctx.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
        // Fissures.
        ctx.strokeStyle = 'rgba(20,16,12,0.5)';
        ctx.lineWidth = 1.5;
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          let px = x * s + rng.range(10, s - 10);
          let py = y * s + rng.range(10, s - 10);
          ctx.moveTo(px, py);
          for (let j = 0; j < 4; j++) {
            px += rng.range(-14, 14);
            py += rng.range(-14, 14);
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }
  }, 11);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function wallTexture(): THREE.Texture {
  const c = noiseCanvas(256, (ctx, rng) => {
    ctx.fillStyle = '#1c1814';
    ctx.fillRect(0, 0, 256, 256);
    const rows = 6;
    const h = 256 / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 32;
      for (let x = -64; x < 256; x += 64) {
        const v = 58 + rng.int(-10, 12);
        ctx.fillStyle = `rgb(${v + 4},${v},${v - 6})`;
        ctx.fillRect(x + off + 2, r * h + 2, 60, h - 4);
      }
    }
  }, 21);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let floorTex: THREE.Texture | null = null;
let wallTex: THREE.Texture | null = null;

/** Uniforms partagés par le shader des murs (découpe autour du joueur). */
export const wallUniforms = {
  uPlayer: { value: new THREE.Vector3() },
  uCutRadius: { value: 4.5 },
};

function makeWallMaterial(): THREE.MeshStandardMaterial {
  wallTex ??= wallTexture();
  const m = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayer = wallUniforms.uPlayer;
    shader.uniforms.uCutRadius = wallUniforms.uCutRadius;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying float vTop;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvTop = step(0.5, objectNormal.y);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying float vTop;\nuniform vec3 uPlayer;\nuniform float uCutRadius;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        // Les murs situés entre la caméra (au sud) et le joueur sont « percés »
        // avec un tramage pour garder le personnage visible.
        {
          vec2 d = vWorldPos.xz - uPlayer.xz;
          float inFront = step(0.6, d.y);
          float r = length(vec2(d.x, d.y * 0.6));
          float cut = inFront * (1.0 - smoothstep(uCutRadius * 0.7, uCutRadius, r)) * step(0.5, vWorldPos.y);
          float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (cut > 0.0 && dither < cut * 0.85) discard;
        }`,
      )
      // Assombrit le bas des murs (occlusion ambiante cheap).
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 1.6, vWorldPos.y));\ndiffuseColor.rgb *= mix(1.0, 0.12, vTop);',
      );
  };
  return m;
}

export interface Torch {
  position: THREE.Vector3;
  flame: THREE.Mesh;
  phase: number;
}

export interface WorldView {
  group: THREE.Group;
  torches: Torch[];
  portal: THREE.Group;
  portalPosition: THREE.Vector3;
  setPortalActive(active: boolean): void;
  update(t: number): void;
  dispose(): void;
}

/** Construit la géométrie 3D d'un étage. */
export function buildWorld(d: Dungeon, seed: number, theme: number): WorldView {
  const group = new THREE.Group();
  const rng = new Rng(seed ^ 0xabcdef);
  floorTex ??= floorTexture();

  // Teinte par étage pour varier l'ambiance (cryptes, catacombes, abysses).
  const tints = [new THREE.Color(1, 0.95, 0.88), new THREE.Color(0.85, 0.92, 1), new THREE.Color(1, 0.82, 0.8), new THREE.Color(0.85, 1, 0.88)];
  const tint = tints[theme % tints.length];

  // --- Sol -----------------------------------------------------------------
  let nFloor = 0;
  for (let i = 0; i < d.tiles.length; i++) if (d.tiles[i] === FLOOR) nFloor++;
  const floorGeo = new THREE.PlaneGeometry(TILE, TILE);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0 });
  const floor = new THREE.InstancedMesh(floorGeo, floorMat, nFloor);
  floor.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let k = 0;
  for (let y = 0; y < d.h; y++)
    for (let x = 0; x < d.w; x++) {
      if (d.tiles[y * d.w + x] !== FLOOR) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (rng.int(0, 3) * Math.PI) / 2);
      m4.compose(new THREE.Vector3(x * TILE + TILE / 2, 0, y * TILE + TILE / 2), q, new THREE.Vector3(1, 1, 1));
      floor.setMatrixAt(k, m4);
      const v = rng.range(0.78, 1.05);
      floor.setColorAt(k, col.copy(tint).multiplyScalar(v));
      k++;
    }
  group.add(floor);

  // --- Murs (uniquement ceux qui bordent le sol) -----------------------------
  const isFloor = (x: number, y: number) => x >= 0 && y >= 0 && x < d.w && y < d.h && d.tiles[y * d.w + x] === FLOOR;
  const wallCells: [number, number][] = [];
  for (let y = 0; y < d.h; y++)
    for (let x = 0; x < d.w; x++) {
      if (isFloor(x, y)) continue;
      let border = false;
      for (let dy = -1; dy <= 1 && !border; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(x + dx, y + dy)) border = true;
      if (border) wallCells.push([x, y]);
    }
  const wallGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  wallGeo.translate(0, WALL_H / 2, 0);
  const walls = new THREE.InstancedMesh(wallGeo, makeWallMaterial(), wallCells.length);
  walls.castShadow = true;
  walls.receiveShadow = true;
  wallCells.forEach(([x, y], i) => {
    const hJitter = rng.range(0.96, 1.06);
    m4.compose(new THREE.Vector3(x * TILE + TILE / 2, 0, y * TILE + TILE / 2), q.identity(), new THREE.Vector3(1, hJitter, 1));
    walls.setMatrixAt(i, m4);
    walls.setColorAt(i, col.copy(tint).multiplyScalar(rng.range(0.8, 1.05)));
  });
  group.add(walls);

  // Plan noir sous le donjon pour éviter de voir le « vide ».
  const voidPlane = new THREE.Mesh(new THREE.PlaneGeometry(d.w * TILE * 2, d.h * TILE * 2), new THREE.MeshBasicMaterial({ color: 0x050403 }));
  voidPlane.rotation.x = -Math.PI / 2;
  voidPlane.position.set((d.w * TILE) / 2, -0.05, (d.h * TILE) / 2);
  group.add(voidPlane);

  // --- Torches ----------------------------------------------------------------
  const torches: Torch[] = [];
  const stickGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.5, 5);
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x3a2614 });
  const flameGeo = new THREE.ConeGeometry(0.13, 0.4, 6);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  for (const t of d.torches) {
    const p = new THREE.Vector3(t.x * TILE + TILE / 2, 1.7, (t.y + 1) * TILE + 0.08);
    const stick = new THREE.Mesh(stickGeo, stickMat);
    stick.position.copy(p);
    stick.rotation.x = 0.5;
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.copy(p).add(new THREE.Vector3(0, 0.35, 0.12));
    group.add(stick, flame);
    torches.push({ position: flame.position.clone(), flame, phase: rng.range(0, 10) });
  }

  // --- Décor : os, rochers, tonneaux ----------------------------------------
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc6ad, roughness: 0.9, flatShading: true });
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a443d, roughness: 1, flatShading: true });
  const boneGeo = new THREE.CapsuleGeometry(0.05, 0.4, 2, 4);
  const rockGeo = new THREE.DodecahedronGeometry(0.35, 0);
  for (const r of d.rooms) {
    const n = rng.int(2, 6);
    for (let i = 0; i < n; i++) {
      const tx = rng.int(r.x, r.x + r.w - 1);
      const ty = rng.int(r.y, r.y + r.h - 1);
      if (!isFloor(tx, ty)) continue;
      const p = new THREE.Vector3(tx * TILE + rng.range(0.3, 1.7), 0, ty * TILE + rng.range(0.3, 1.7));
      if (rng.chance(0.55)) {
        for (let b = 0; b < 3; b++) {
          const bone = new THREE.Mesh(boneGeo, boneMat);
          bone.position.copy(p).add(new THREE.Vector3(rng.range(-0.3, 0.3), 0.05, rng.range(-0.3, 0.3)));
          bone.rotation.set(Math.PI / 2, 0, rng.range(0, Math.PI));
          bone.receiveShadow = true;
          group.add(bone);
        }
      } else {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.copy(p).setY(0.1);
        rock.scale.setScalar(rng.range(0.5, 1.1));
        rock.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
        rock.castShadow = true;
        group.add(rock);
      }
    }
  }

  // --- Portail de sortie --------------------------------------------------------
  const exit = d.rooms[d.exitRoom];
  const portalPosition = tileCenter(exit.cx, exit.cy);
  const portal = new THREE.Group();
  portal.position.copy(portalPosition);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x555060, roughness: 0.6, metalness: 0.3, flatShading: true });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.18, 6, 18), ringMat);
  ring.position.y = 1.5;
  ring.castShadow = true;
  const portalUniforms = { uTime: { value: 0 }, uActive: { value: 0 } };
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 32),
    new THREE.ShaderMaterial({
      uniforms: portalUniforms,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        varying vec2 vUv; uniform float uTime; uniform float uActive;
        void main(){
          vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float swirl = sin(a * 5.0 + r * 9.0 - uTime * 3.0) * 0.5 + 0.5;
          vec3 off = vec3(0.15, 0.13, 0.18);
          vec3 on = mix(vec3(0.25, 0.5, 1.0), vec3(0.75, 0.9, 1.0), swirl);
          vec3 c = mix(off * (0.6 + swirl * 0.4), on, uActive);
          float alpha = (1.0 - smoothstep(0.85, 1.0, r)) * mix(0.55, 0.92, uActive);
          gl_FragColor = vec4(c * (1.2 - r * 0.5), alpha);
        }`,
    }),
  );
  disk.position.y = 1.5;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.2, 10), ringMat);
  base.position.y = 0.1;
  base.receiveShadow = true;
  portal.add(ring, disk, base);
  group.add(portal);

  return {
    group,
    torches,
    portal,
    portalPosition,
    setPortalActive(active: boolean) {
      portalUniforms.uActive.value = active ? 1 : 0;
      ringMat.emissive.setHex(active ? 0x223a66 : 0x000000);
    },
    update(t: number) {
      portalUniforms.uTime.value = t;
      ring.rotation.z = t * 0.2;
      for (const tr of torches) {
        const f = 0.85 + Math.sin(t * 13 + tr.phase) * 0.1 + Math.sin(t * 7.3 + tr.phase * 2) * 0.08;
        tr.flame.scale.set(1, f, 1);
      }
    },
    dispose() {
      group.traverse((o) => {
        const me = o as THREE.Mesh;
        if (me.isMesh) {
          me.geometry.dispose();
          const mm = me.material as THREE.Material | THREE.Material[];
          (Array.isArray(mm) ? mm : [mm]).forEach((x) => x.dispose());
        }
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Collisions et ligne de vue sur la grille.
// ---------------------------------------------------------------------------

export class Collision {
  constructor(private readonly d: Dungeon) {}

  isFloorTile(tx: number, ty: number): boolean {
    const { d } = this;
    return tx >= 0 && ty >= 0 && tx < d.w && ty < d.h && d.tiles[ty * d.w + tx] === FLOOR;
  }

  isWalkable(x: number, z: number): boolean {
    return this.isFloorTile(toTile(x), toTile(z));
  }

  /** Le cercle (x, z, r) chevauche-t-il un mur ? */
  circleHitsWall(x: number, z: number, r: number): boolean {
    const x0 = toTile(x - r);
    const x1 = toTile(x + r);
    const z0 = toTile(z - r);
    const z1 = toTile(z + r);
    for (let ty = z0; ty <= z1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        if (this.isFloorTile(tx, ty)) continue;
        const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
        const cz = Math.max(ty * TILE, Math.min(z, (ty + 1) * TILE));
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    return false;
  }

  /** Déplace un cercle en glissant le long des murs. Modifie `pos` en place. */
  move(pos: THREE.Vector3, dx: number, dz: number, r: number): void {
    // Sous-pas pour ne jamais traverser un mur à grande vitesse.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (r * 0.8)));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (!this.circleHitsWall(pos.x + sx, pos.z, r)) pos.x += sx;
      if (!this.circleHitsWall(pos.x, pos.z + sz, r)) pos.z += sz;
    }
  }

  /** Ligne de vue dégagée entre deux points (échantillonnage). */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    const n = Math.ceil(dist / (TILE * 0.25));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (!this.isWalkable(a.x + dx * t, a.z + dz * t)) return false;
    }
    return true;
  }
}
