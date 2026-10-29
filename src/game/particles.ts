import * as THREE from 'three';

/**
 * Système de particules unique (THREE.Points, mélange additif).
 * Toutes les particules du jeu passent par ici : étincelles, sang d'os,
 * flammes, givre, poussière… ~3 000 particules max, un seul draw call.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private readonly geo: THREE.BufferGeometry;

  constructor(max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha; uniform float uScale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(vColor * a, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setViewportHeight(h: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h * 0.6;
  }

  emit(p: {
    x: number;
    y: number;
    z: number;
    vx?: number;
    vy?: number;
    vz?: number;
    color: THREE.Color | number;
    size?: number;
    life?: number;
    gravity?: number;
    drag?: number;
  }): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0;
    this.vel[i * 3 + 1] = p.vy ?? 0;
    this.vel[i * 3 + 2] = p.vz ?? 0;
    const c = typeof p.color === 'number' ? tmpColor.setHex(p.color) : p.color;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.life[i] = this.maxLife[i] = p.life ?? 0.6;
    this.baseSize[i] = p.size ?? 0.3;
    this.gravity[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 1.5;
  }

  /** Gerbe d'étincelles dans toutes les directions. */
  burst(at: THREE.Vector3, color: number, count: number, speed = 5, opts: { size?: number; life?: number; gravity?: number; up?: number } = {}): void {
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.2) * Math.PI * 0.5;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.emit({
        x: at.x,
        y: at.y,
        z: at.z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.sin(e) * s + (opts.up ?? 1.5),
        vz: Math.sin(a) * Math.cos(e) * s,
        color,
        size: (opts.size ?? 0.25) * (0.6 + Math.random() * 0.8),
        life: (opts.life ?? 0.5) * (0.6 + Math.random() * 0.8),
        gravity: opts.gravity ?? 9,
      });
    }
  }

  /** Anneau de particules au sol (nova, slam, apparition). */
  ring(at: THREE.Vector3, radius: number, color: number, count: number, opts: { speed?: number; size?: number; life?: number; y?: number } = {}): void {
    for (let n = 0; n < count; n++) {
      const a = (n / count) * Math.PI * 2;
      const sp = opts.speed ?? 6;
      this.emit({
        x: at.x + Math.cos(a) * radius,
        y: (opts.y ?? 0.3) + Math.random() * 0.3,
        z: at.z + Math.sin(a) * radius,
        vx: Math.cos(a) * sp,
        vy: Math.random() * 1.5,
        vz: Math.sin(a) * sp,
        color,
        size: opts.size ?? 0.4,
        life: opts.life ?? 0.5,
        drag: 3,
      });
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const dragK = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dragK;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dragK - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= dragK;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.03, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.min(1, k * 1.6);
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * k);
    }
    for (const name of ['position', 'color', 'size', 'alpha']) this.geo.getAttribute(name).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}

const tmpColor = new THREE.Color();
