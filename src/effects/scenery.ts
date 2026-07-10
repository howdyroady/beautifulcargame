import * as THREE from 'three';

/** Low-poly pine tree. */
function buildTree(): THREE.Group {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 1, 6), trunkMat);
  trunk.position.y = 0.5;
  group.add(trunk);

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1a4a28, roughness: 0.85 });
  for (let i = 0; i < 3; i++) {
    const radius = 1.1 - i * 0.28;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, 1.1, 7), leafMat);
    cone.position.y = 1.1 + i * 0.7;
    group.add(cone);
  }
  return group;
}

/** Floodlight pole with glowing emissive lamp — plays nicely with bloom. */
function buildLightPole(): THREE.Group {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.4 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 8), poleMat);
  pole.position.y = 2.75;
  group.add(pole);

  const headMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.35), headMat);
  head.position.y = 5.6;
  group.add(head);

  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff6d8,
    emissive: 0xffe8a0,
    emissiveIntensity: 2.8,
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lampMat);
  lamp.position.set(0, 5.45, 0.18);
  group.add(lamp);

  return group;
}

/** LED advertisement billboard (tall, thin, glowing). */
function buildBillboard(): THREE.Group {
  const group = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6, metalness: 0.5 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 6), postMat);
  post.position.y = 2;
  group.add(post);

  // LED panel
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  // Random ad colors
  const colors = ['#ff3050', '#1080ff', '#40ff80', '#ff8020', '#c040ff', '#00d0d0'];
  const bgColor = colors[Math.floor(Math.random() * colors.length)];
  ctx.fillStyle = '#0a0a0e';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = bgColor;
  ctx.fillRect(4, 4, 120, 56);
  // Fake text lines
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(12, 14, 50 + Math.random() * 40, 6);
  ctx.fillRect(12, 28, 30 + Math.random() * 50, 5);
  ctx.fillRect(12, 40, 40 + Math.random() * 30, 5);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  // Parse the hex color for emissive
  const r = parseInt(bgColor.slice(1, 3), 16) / 255;
  const g = parseInt(bgColor.slice(3, 5), 16) / 255;
  const b = parseInt(bgColor.slice(5, 7), 16) / 255;

  const panelMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color(r * 0.4, g * 0.4, b * 0.4),
    emissiveIntensity: 1.8,
    roughness: 0.3,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 1.8), panelMat);
  panel.position.y = 4.5;
  group.add(panel);

  // Back-face (dark)
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8 }),
  );
  back.position.y = 4.5;
  back.position.z = -0.02;
  back.rotation.y = Math.PI;
  group.add(back);

  return group;
}

/** Scatters trees in an annulus. */
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

/** LED advertisement billboards along the track. */
export function addBillboards(
  scene: THREE.Scene,
  curve: THREE.CatmullRomCurve3,
  count: number,
  trackWidth: number,
) {
  const group = new THREE.Group();
  group.userData.persistent = false;
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const pos = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).setY(0).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const side = i % 2 === 0 ? 1 : -1;
    const offset = trackWidth / 2 + 3 + Math.random() * 4;

    const billboard = buildBillboard();
    billboard.position.copy(pos).addScaledVector(left, side * offset);
    billboard.lookAt(pos.x, billboard.position.y, pos.z);
    group.add(billboard);
  }
  scene.add(group);
  return group;
}
