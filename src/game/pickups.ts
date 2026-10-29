import * as THREE from 'three';
import { RARITY_COLORS, type Item } from '../core/loot';

export type PickupKind = 'gold' | 'item' | 'potion';

export interface Pickup {
  kind: PickupKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  amount: number;
  item?: Item;
  mesh: THREE.Group;
  age: number;
  /** L'objet ne peut pas être ramassé (sac plein) : on évite de spammer le message. */
  blockedUntil: number;
  taken: boolean;
}

const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.04, 8);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xf2c84b, metalness: 0.9, roughness: 0.3, emissive: 0x3a2800 });
const flaskGeo = new THREE.SphereGeometry(0.2, 8, 6);
const flaskMat = new THREE.MeshStandardMaterial({ color: 0xd8203a, emissive: 0x500010, roughness: 0.2 });
const neckGeo = new THREE.CylinderGeometry(0.06, 0.07, 0.15, 6);
const corkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a40 });
const beamGeo = new THREE.CylinderGeometry(0.12, 0.3, 3.2, 8, 1, true);
beamGeo.translate(0, 1.6, 0);
const itemGeo = new THREE.OctahedronGeometry(0.28, 0);

export function makePickupMesh(kind: PickupKind, item?: Item): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'gold') {
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(coinGeo, coinMat);
      c.position.set((Math.random() - 0.5) * 0.3, 0.03 + i * 0.04, (Math.random() - 0.5) * 0.3);
      c.castShadow = true;
      g.add(c);
    }
  } else if (kind === 'potion') {
    const f = new THREE.Mesh(flaskGeo, flaskMat);
    f.position.y = 0.25;
    const n = new THREE.Mesh(neckGeo, corkMat);
    n.position.y = 0.5;
    g.add(f, n);
  } else if (item) {
    const color = new THREE.Color(RARITY_COLORS[item.rarity]);
    const gem = new THREE.Mesh(itemGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, flatShading: true, metalness: 0.5 }));
    gem.position.y = 0.5;
    gem.name = 'gem';
    gem.castShadow = true;
    g.add(gem);
    if (item.rarity !== 'common') {
      const beam = new THREE.Mesh(
        beamGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: item.rarity === 'legendary' ? 0.45 : 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      );
      g.add(beam);
    }
  }
  return g;
}
