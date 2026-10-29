import * as THREE from 'three';

/** Modèles low-poly procéduraux (aucun asset externe). */

export interface Rig {
  root: THREE.Group;
  /** Pivot qui porte tout le corps (pour bob / inclinaison). */
  body: THREE.Group;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  head: THREE.Object3D;
  /** Matériaux à faire clignoter quand le personnage est touché. */
  flashMaterials: THREE.MeshStandardMaterial[];
  height: number;
}

export interface HumanoidOptions {
  skin: number;
  torso: number;
  legs: number;
  accent?: number;
  eyes?: number;
  scale?: number;
  bony?: boolean;
  weapon?: 'sword' | 'axe' | 'bow' | 'club' | 'staff' | 'none';
  shield?: boolean;
  helm?: 'none' | 'helm' | 'horns' | 'crown' | 'hood';
  cape?: number;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g as T;
}

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: true, ...opts });
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, cast = true): THREE.Mesh {
  const me = new THREE.Mesh(geo, m);
  me.castShadow = cast;
  me.receiveShadow = false;
  return me;
}

export function buildHumanoid(o: HumanoidOptions): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const flash: THREE.MeshStandardMaterial[] = [];
  const skinM = mat(o.skin, o.bony ? { roughness: 0.9 } : {});
  const torsoM = mat(o.torso, { metalness: o.bony ? 0 : 0.35, roughness: 0.55 });
  const legsM = mat(o.legs);
  flash.push(skinM, torsoM, legsM);
  const limbW = o.bony ? 0.11 : 0.17;

  // Jambes : pivot à la hanche.
  const mkLeg = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.85, 0);
    const leg = mesh(cached(`leg${limbW}`, () => new THREE.BoxGeometry(limbW, 0.85, limbW + 0.04)), legsM);
    leg.position.y = -0.42;
    pivot.add(leg);
    const foot = mesh(cached('foot', () => new THREE.BoxGeometry(0.2, 0.1, 0.3)), legsM);
    foot.position.set(0, -0.82, 0.06);
    pivot.add(foot);
    body.add(pivot);
    return pivot;
  };
  const legL = mkLeg(-0.16);
  const legR = mkLeg(0.16);

  // Torse.
  const torsoGeo = o.bony
    ? cached('ribs', () => new THREE.CylinderGeometry(0.2, 0.14, 0.62, 6))
    : cached('torso', () => new THREE.CylinderGeometry(0.3, 0.24, 0.7, 7));
  const torso = mesh(torsoGeo, torsoM);
  torso.position.y = 1.2;
  body.add(torso);
  if (o.bony) {
    const ribM = skinM;
    for (let i = 0; i < 3; i++) {
      const rib = mesh(cached('rib', () => new THREE.TorusGeometry(0.2, 0.03, 4, 8)), ribM, false);
      rib.rotation.x = Math.PI / 2;
      rib.position.y = 1.05 + i * 0.14;
      body.add(rib);
    }
  } else {
    const belt = mesh(cached('belt', () => new THREE.CylinderGeometry(0.26, 0.26, 0.1, 7)), mat(0x3b2a1a));
    belt.position.y = 0.9;
    body.add(belt);
    const shoulders = mesh(cached('shoulders', () => new THREE.BoxGeometry(0.78, 0.16, 0.34)), torsoM);
    shoulders.position.y = 1.5;
    body.add(shoulders);
  }

  // Tête.
  const head = new THREE.Group();
  head.position.y = 1.78;
  const skull = mesh(
    o.bony
      ? cached('skull', () => new THREE.IcosahedronGeometry(0.2, 0))
      : cached('head', () => new THREE.IcosahedronGeometry(0.2, 1)),
    skinM,
  );
  head.add(skull);
  if (o.eyes !== undefined) {
    const eyeM = new THREE.MeshBasicMaterial({ color: o.eyes });
    for (const x of [-0.075, 0.075]) {
      const eye = mesh(cached('eye', () => new THREE.SphereGeometry(0.035, 6, 4)), eyeM, false);
      eye.position.set(x, 0.02, 0.17);
      head.add(eye);
    }
  }
  const helmM = mat(o.accent ?? 0x777777, { metalness: 0.6, roughness: 0.4 });
  if (o.helm === 'helm' || o.helm === 'horns') {
    const helm = mesh(cached('helm', () => new THREE.CylinderGeometry(0.22, 0.24, 0.24, 8, 1, false)), helmM);
    helm.position.y = 0.08;
    head.add(helm);
    const top = mesh(cached('helmtop', () => new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)), helmM);
    top.position.y = 0.2;
    head.add(top);
    if (o.helm === 'horns') {
      for (const s of [-1, 1]) {
        const horn = mesh(cached('horn', () => new THREE.ConeGeometry(0.06, 0.32, 5)), mat(0xe8dcc0));
        horn.position.set(0.22 * s, 0.25, 0);
        horn.rotation.z = -0.9 * s;
        head.add(horn);
      }
    }
  } else if (o.helm === 'crown') {
    const crown = mesh(cached('crown', () => new THREE.CylinderGeometry(0.24, 0.22, 0.14, 8, 1, true)), mat(0xd6a531, { metalness: 0.9, roughness: 0.3, emissive: 0x3a2500, side: THREE.DoubleSide }));
    crown.position.y = 0.2;
    head.add(crown);
    for (let i = 0; i < 6; i++) {
      const spike = mesh(cached('spike', () => new THREE.ConeGeometry(0.04, 0.14, 4)), crown.material as THREE.Material, false);
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.23, 0.33, Math.sin(a) * 0.23);
      head.add(spike);
    }
  } else if (o.helm === 'hood') {
    const hood = mesh(cached('hood', () => new THREE.ConeGeometry(0.28, 0.55, 7)), mat(o.accent ?? 0x333333));
    hood.position.set(0, 0.12, -0.04);
    head.add(hood);
  }
  body.add(head);

  // Bras : pivot à l'épaule.
  const mkArm = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.48, 0);
    const arm = mesh(cached(`arm${limbW}`, () => new THREE.BoxGeometry(limbW, 0.7, limbW)), o.bony ? skinM : torsoM);
    arm.position.y = -0.33;
    pivot.add(arm);
    const hand = mesh(cached('hand', () => new THREE.BoxGeometry(0.13, 0.13, 0.13)), skinM);
    hand.position.y = -0.72;
    pivot.add(hand);
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-0.4);
  const armR = mkArm(0.4);

  // Arme dans la main droite (orientée vers l'avant quand le bras est levé).
  const weaponHolder = new THREE.Group();
  weaponHolder.position.y = -0.74;
  armR.add(weaponHolder);
  const steel = mat(0xc9ccd2, { metalness: 0.9, roughness: 0.25 });
  const wood = mat(0x5a3b20);
  switch (o.weapon ?? 'none') {
    case 'sword': {
      const blade = mesh(cached('blade', () => new THREE.BoxGeometry(0.07, 0.04, 1.0)), steel);
      blade.position.z = 0.6;
      const guard = mesh(cached('guard', () => new THREE.BoxGeometry(0.3, 0.06, 0.06)), mat(0xb08a3a, { metalness: 0.8 }));
      guard.position.z = 0.1;
      weaponHolder.add(blade, guard);
      break;
    }
    case 'axe': {
      const haft = mesh(cached('haft', () => new THREE.BoxGeometry(0.06, 0.06, 0.9)), wood);
      haft.position.z = 0.4;
      const bit = mesh(cached('axebit', () => new THREE.BoxGeometry(0.04, 0.32, 0.25)), steel);
      bit.position.set(0, 0.12, 0.75);
      weaponHolder.add(haft, bit);
      break;
    }
    case 'club': {
      const club = mesh(cached('club', () => new THREE.CylinderGeometry(0.16, 0.07, 1.1, 6)), wood);
      club.rotation.x = Math.PI / 2;
      club.position.z = 0.55;
      weaponHolder.add(club);
      break;
    }
    case 'staff': {
      const staff = mesh(cached('staff', () => new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5)), wood);
      staff.rotation.x = Math.PI / 2;
      staff.position.z = 0.3;
      const orb = mesh(cached('orb', () => new THREE.IcosahedronGeometry(0.12, 0)), new THREE.MeshBasicMaterial({ color: 0xb06bff }), false);
      orb.position.z = 1.1;
      weaponHolder.add(staff, orb);
      break;
    }
    case 'bow': {
      const bow = mesh(cached('bow', () => new THREE.TorusGeometry(0.45, 0.03, 4, 10, Math.PI)), wood);
      bow.rotation.y = Math.PI / 2;
      bow.position.z = 0.1;
      weaponHolder.add(bow);
      break;
    }
  }
  if (o.shield) {
    const shield = mesh(cached('shield', () => new THREE.CylinderGeometry(0.32, 0.32, 0.06, 8)), mat(o.accent ?? 0x6b2a22, { metalness: 0.4 }));
    shield.rotation.z = Math.PI / 2;
    shield.position.set(-0.08, -0.5, 0.1);
    armL.add(shield);
  }
  if (o.cape !== undefined) {
    const capeM = mat(o.cape, { side: THREE.DoubleSide });
    flash.push(capeM);
    const cape = mesh(cached('cape', () => {
      const g = new THREE.PlaneGeometry(0.62, 1.1, 1, 3);
      g.translate(0, -0.55, 0);
      return g;
    }), capeM);
    cape.position.set(0, 1.52, -0.2);
    cape.rotation.x = 0.12;
    cape.name = 'cape';
    body.add(cape);
  }

  const s = o.scale ?? 1;
  root.scale.setScalar(s);
  return { root, body, legL, legR, armL, armR, head, flashMaterials: flash, height: 2 * s };
}

/** Animation procédurale commune : marche, attaque, mort. */
export function animateRig(
  rig: Rig,
  t: number,
  opts: { moving: number; attack: number; attackStyle?: 'swing' | 'thrust' | 'cast' | 'spin'; dead?: number },
): void {
  const walk = Math.sin(t * 10) * opts.moving;
  rig.legL.rotation.x = walk * 0.7;
  rig.legR.rotation.x = -walk * 0.7;
  rig.body.position.y = Math.abs(Math.sin(t * 10)) * 0.06 * opts.moving;
  rig.armL.rotation.x = -walk * 0.5;
  rig.armR.rotation.set(walk * 0.5, 0, 0);
  rig.body.rotation.set(0, 0, 0);

  const a = opts.attack; // 0 → 1 au cours de l'attaque
  if (a > 0) {
    switch (opts.attackStyle ?? 'swing') {
      case 'swing': {
        // Armé au-dessus puis balayage de droite à gauche.
        const k = a < 0.35 ? a / 0.35 : 1 - (a - 0.35) / 0.65;
        const sweep = a < 0.35 ? -1 : -1 + ((a - 0.35) / 0.65) * 2.4;
        rig.armR.rotation.x = -1.4 * k - 0.2;
        rig.armR.rotation.z = 0;
        rig.armR.rotation.y = 0;
        rig.body.rotation.y = -sweep * 0.5;
        rig.armR.rotation.z = sweep * 0.9;
        break;
      }
      case 'thrust': {
        const k = Math.sin(a * Math.PI);
        rig.armR.rotation.x = -1.5 * k;
        rig.armL.rotation.x = -1.3 * k;
        break;
      }
      case 'cast': {
        const k = Math.sin(a * Math.PI);
        rig.armR.rotation.x = -1.6 * k;
        rig.armL.rotation.x = -1.6 * k;
        rig.body.rotation.x = -0.15 * k;
        break;
      }
      case 'spin': {
        rig.armR.rotation.x = -1.5;
        rig.armL.rotation.x = -1.2;
        rig.body.rotation.y = a * Math.PI * 4;
        break;
      }
    }
  }
  if (opts.dead !== undefined) {
    const d = Math.min(1, opts.dead * 2.5);
    rig.body.rotation.x = -d * (Math.PI / 2) * 0.95;
    rig.body.position.y = 0.2 * d;
  }
}

export function setFlash(rig: Rig, amount: number, color = 0xffffff): void {
  for (const m of rig.flashMaterials) {
    m.emissive.setHex(color);
    m.emissiveIntensity = amount;
  }
}

/** Chauve-souris : corps + deux ailes qui battent. */
export function buildBat(): Rig & { wings: THREE.Object3D[] } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const m = mat(0x2a1d2e);
  const b = mesh(cached('batbody', () => new THREE.IcosahedronGeometry(0.25, 0)), m);
  b.position.y = 1.4;
  body.add(b);
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xff3b2f });
  for (const x of [-0.08, 0.08]) {
    const e = mesh(cached('bateye', () => new THREE.SphereGeometry(0.04, 5, 3)), eyeM, false);
    e.position.set(x, 1.45, 0.21);
    body.add(e);
  }
  const wings: THREE.Object3D[] = [];
  const wingM = mat(0x3d2840, { side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0.15 * s, 1.42, 0);
    const w = mesh(cached('wing', () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.15, 0.7, 0.1, 0, 0.5, 0, -0.3, 0, 0, -0.1, 0, 0, 0.15, 0.5, 0, -0.3], 3));
      g.computeVertexNormals();
      return g;
    }), wingM);
    w.scale.x = s;
    pivot.add(w);
    body.add(pivot);
    wings.push(pivot);
  }
  const dummy = new THREE.Object3D();
  return { root, body, legL: dummy, legR: dummy, armL: dummy, armR: dummy, head: b, flashMaterials: [m, wingM], height: 1.6, wings };
}

/** Disque de sélection / ombre sous les personnages. */
export function buildShadowBlob(radius: number): THREE.Mesh {
  const g = cached(`blob${radius}`, () => new THREE.CircleGeometry(radius, 16));
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
  const me = new THREE.Mesh(g, m);
  me.rotation.x = -Math.PI / 2;
  me.position.y = 0.02;
  me.renderOrder = 1;
  return me;
}
