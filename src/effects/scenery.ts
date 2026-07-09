import * as THREE from 'three';

/** Low-poly pine tree (cone + trunk) — cheap scenery to break up the empty void around arenas/tracks. */
function buildTree(): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1, 6), trunkMat);
  trunk.position.y = 0.5;
  group.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f4a2a, roughness: 0.85 });
  for (let i = 0; i < 3; i++) {
    const radius = 1.1 - i * 0.28;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, 1.1, 7), leafMat);
    cone.position.y = 1.1 + i * 0.7;
    group.add(cone);
  }
  return group;
}

/** Floodlight pole with a glowing emissive lamp head — plays nicely with bloom, reinforces the night-race look. */
function buildLightPole(): THREE.Group {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.5, 8), poleMat);
  pole.position.y = 2.25;
  group.add(pole);

  const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.3), headMat);
  head.position.y = 4.6;
  group.add(head);

  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xffe8a0, emissiveIntensity: 2.2 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), lampMat);
  lamp.position.set(0, 4.45, 0.16);
  group.add(lamp);

  return group;
}

/** Scatters trees at random angles/radii in an annulus just outside the playable area. */
export function addTrees(scene: THREE.Scene, innerRadius: number, outerRadius: number, count: number) {
  const group = new THREE.Group();
  group.userData.persistent = false;
  for (let i = 0; i < count; i++) {
    const tree = buildTree();
    const angle = Math.random() * Math.PI * 2;
    const radius = innerRadius + Math.random() * (outerRadius - innerRadius);
    const scale = 0.7 + Math.random() * 0.8;
    tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    tree.scale.setScalar(scale);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    group.add(tree);
  }
  scene.add(group);
  return group;
}

/** Evenly-spaced floodlight poles around the perimeter. */
export function addLightPoles(scene: THREE.Scene, radius: number, count: number) {
  const group = new THREE.Group();
  group.userData.persistent = false;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const pole = buildLightPole();
    pole.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    pole.lookAt(0, pole.position.y, 0);
    group.add(pole);
  }
  scene.add(group);
  return group;
}
