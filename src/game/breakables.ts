import * as THREE from 'three';

/** Jarres et tonneaux destructibles qui cachent un peu de butin. */
export interface Breakable {
  pos: THREE.Vector3;
  mesh: THREE.Object3D;
  kind: 'urn' | 'barrel';
  broken: boolean;
}

const urnGeo = (() => {
  const pts: THREE.Vector2[] = [];
  const prof = [0.12, 0.28, 0.34, 0.3, 0.18, 0.14, 0.18];
  prof.forEach((r, i) => pts.push(new THREE.Vector2(r, (i / (prof.length - 1)) * 0.8)));
  return new THREE.LatheGeometry(pts, 8);
})();
const urnMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.85, flatShading: true });
const barrelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.9, 10);
const barrelMat = new THREE.MeshStandardMaterial({ color: 0x5c3e22, roughness: 0.9, flatShading: true });
const hoopGeo = new THREE.TorusGeometry(0.35, 0.025, 4, 12);
const hoopMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.4 });

export function makeBreakable(kind: 'urn' | 'barrel', pos: THREE.Vector3): Breakable {
  const g = new THREE.Group();
  if (kind === 'urn') {
    const m = new THREE.Mesh(urnGeo, urnMat);
    m.castShadow = true;
    g.add(m);
  } else {
    const m = new THREE.Mesh(barrelGeo, barrelMat);
    m.position.y = 0.45;
    m.castShadow = true;
    g.add(m);
    for (const y of [0.18, 0.72]) {
      const h = new THREE.Mesh(hoopGeo, hoopMat);
      h.rotation.x = Math.PI / 2;
      h.position.y = y;
      g.add(h);
    }
  }
  g.position.copy(pos);
  g.rotation.y = Math.random() * Math.PI * 2;
  return { pos: pos.clone(), mesh: g, kind, broken: false };
}
