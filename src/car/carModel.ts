import * as THREE from 'three';

export interface CarDimensions {
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
}

export const CAR_DIMENSIONS: CarDimensions = {
  length: 4.6,
  width: 1.85,
  height: 1.4,
  wheelRadius: 0.36,
};

/** Builds a canvas texture approximating the C204's twin-louvre chrome grille. */
function buildGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const louvreCount = 2;
  const gap = 14;
  const louvreHeight = (canvas.height - gap * (louvreCount + 1)) / louvreCount;
  for (let i = 0; i < louvreCount; i++) {
    const y = gap + i * (louvreHeight + gap);
    const grad = ctx.createLinearGradient(0, y, 0, y + louvreHeight);
    grad.addColorStop(0, '#f4f5f7');
    grad.addColorStop(0.45, '#9a9ea6');
    grad.addColorStop(0.55, '#7a7e86');
    grad.addColorStop(1, '#e8e9eb');
    ctx.fillStyle = grad;
    ctx.fillRect(8, y, canvas.width - 16, louvreHeight);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Radial multi-spoke alloy wheel, styled after the deep-concave aftermarket rims in the reference photos. */
function buildWheel(radius: number, thickness: number): THREE.Group {
  const wheel = new THREE.Group();

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9, metalness: 0.05 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, 24), tireMat);
  tire.rotation.z = Math.PI / 2;
  wheel.add(tire);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4d6da, roughness: 0.25, metalness: 0.9 });
  const barrelRadius = radius * 0.72;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(barrelRadius, barrelRadius, thickness * 1.02, 24), rimMat);
  barrel.rotation.z = Math.PI / 2;
  wheel.add(barrel);

  const hubMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.7 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, thickness * 1.08, 16), hubMat);
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);

  const spokeCount = 5;
  const spokeGeo = new THREE.BoxGeometry(thickness * 0.9, barrelRadius * 0.92, radius * 0.16);
  for (let i = 0; i < spokeCount; i++) {
    for (const twist of [-1, 1]) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (i / spokeCount) * Math.PI * 2 + (twist > 0 ? 0.16 : -0.02);
      spoke.position.set(0, Math.cos(spoke.rotation.x) * barrelRadius * 0.46, 0);
      wheel.add(spoke);
    }
  }

  wheel.rotation.y = Math.PI / 2;
  return wheel;
}

/**
 * Coupe silhouette as a simple (non-self-intersecting) polygon, traced counter-clockwise:
 * rear bumper -> up over trunk/roof/hood -> front bumper -> straight back along the rocker sill.
 * Deliberately straight-edged/low-poly rather than curve-fit — easier to keep valid for ExtrudeGeometry.
 */
function bodyProfileShape(length: number, height: number): THREE.Shape {
  const halfL = length / 2;
  const pts: [number, number][] = [
    [-1.0, 0.06],
    [-1.0, 0.32],
    [-0.82, 0.5],
    [-0.58, 0.78],
    [-0.32, 0.96],
    [0.06, 1.0],
    [0.3, 0.94],
    [0.48, 0.68],
    [0.68, 0.46],
    [0.85, 0.34],
    [1.0, 0.28],
    [1.0, 0.06],
  ];
  const shape = new THREE.Shape();
  // Reversed so the contour winds counter-clockwise (required for correctly-facing extrude normals).
  const ordered = [...pts].reverse();
  ordered.forEach(([fx, fy], i) => {
    const x = fx * halfL;
    const y = fy * height;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

export interface CarModel {
  group: THREE.Group;
  wheels: THREE.Group[];
  dims: CarDimensions;
}

export function createCarModel(paintColor = 0x9aa0a8): CarModel {
  const { length, width, height, wheelRadius } = CAR_DIMENSIONS;
  const group = new THREE.Group();

  const paintMat = new THREE.MeshStandardMaterial({ color: paintColor, roughness: 0.35, metalness: 0.6 });
  const blackTrimMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.6, metalness: 0.2 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.82 });

  // Main body: extrude the side silhouette across the car's width.
  const bodyShape = bodyProfileShape(length, height * 0.78);
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: width, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 8 });
  bodyGeo.center();
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.rotation.y = Math.PI / 2;
  body.position.y = wheelRadius * 0.62;
  group.add(body);

  // Greenhouse (glass band) — slightly narrower, sits inset within the roofline. Simple hexagon, straight edges only.
  const glassShape = new THREE.Shape();
  const halfL = length / 2;
  const h = height * 0.78;
  glassShape.moveTo(-halfL * 0.56, 0.56 * h);
  glassShape.lineTo(halfL * 0.4, 0.56 * h);
  glassShape.lineTo(halfL * 0.46, 0.68 * h);
  glassShape.lineTo(halfL * 0.32, 0.9 * h);
  glassShape.lineTo(halfL * 0.02, 0.94 * h);
  glassShape.lineTo(-halfL * 0.34, 0.82 * h);
  glassShape.lineTo(-halfL * 0.56, 0.58 * h);
  const glassGeo = new THREE.ExtrudeGeometry(glassShape, { depth: width * 0.94, bevelEnabled: false, curveSegments: 8 });
  glassGeo.center();
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.rotation.y = Math.PI / 2;
  glass.position.y = wheelRadius * 0.62;
  glass.position.x = 0.001;
  group.add(glass);

  // Front grille + AMG-style apron.
  const grilleTex = buildGrilleTexture();
  const grilleMat = new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.3, metalness: 0.8 });
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.5, height * 0.28), grilleMat);
  grille.position.set(halfL - 0.02, wheelRadius * 0.62 + height * 0.16, 0);
  grille.rotation.y = -Math.PI / 2;
  group.add(grille);

  const starMat = new THREE.MeshStandardMaterial({ color: 0xe8e9eb, roughness: 0.15, metalness: 0.95 });
  const star = new THREE.Mesh(new THREE.TorusGeometry(width * 0.11, width * 0.014, 8, 20), starMat);
  star.rotation.y = Math.PI / 2;
  star.position.set(halfL - 0.01, wheelRadius * 0.62 + height * 0.16, 0);
  group.add(star);

  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.3, height * 0.22, width * 0.98), blackTrimMat);
  apron.position.set(halfL - 0.14, wheelRadius * 0.36, 0);
  group.add(apron);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, width * 1.02), blackTrimMat);
  splitter.position.set(halfL - 0.02, wheelRadius * 0.12, 0);
  group.add(splitter);

  // Headlights with LED DRL strip (emissive).
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xf2f4ff, roughness: 0.1, metalness: 0.2 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xbfe0ff, emissive: 0x8fd0ff, emissiveIntensity: 1.6, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.16, height * 0.16, width * 0.32), headlightMat);
    headlight.position.set(halfL - 0.24, wheelRadius * 0.62 + height * 0.2, side * width * 0.33);
    group.add(headlight);

    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, width * 0.28), ledMat);
    led.position.set(halfL - 0.15, wheelRadius * 0.62 + height * 0.26, side * width * 0.33);
    group.add(led);

    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.22, height * 0.12, width * 0.18), blackTrimMat);
    intake.position.set(halfL - 0.16, wheelRadius * 0.34, side * width * 0.38);
    group.add(intake);
  }

  // Taillights, red LED strip.
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x3a0708, emissive: 0xaa1015, emissiveIntensity: 1.2, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, height * 0.22, width * 0.3), tailMat);
    tail.position.set(-halfL + 0.1, wheelRadius * 0.62 + height * 0.3, side * width * 0.34);
    group.add(tail);
  }

  // Side mirrors.
  const mirrorMat = new THREE.MeshStandardMaterial({ color: paintColor, roughness: 0.4, metalness: 0.5 });
  for (const side of [-1, 1]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), mirrorMat);
    mirror.position.set(halfL * 0.18, wheelRadius * 0.62 + height * 0.6, side * (width / 2 + 0.05));
    group.add(mirror);
  }

  // Side skirts.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(length * 0.55, 0.08, width * 1.03), blackTrimMat);
  skirt.position.set(0, wheelRadius * 0.3, 0);
  group.add(skirt);

  // Wheels.
  const wheelThickness = width * 0.22;
  const wheels: THREE.Group[] = [];
  const wheelX = length * 0.32;
  const wheelZ = width / 2 - wheelThickness * 0.3;
  for (const xSign of [1, -1]) {
    for (const zSign of [1, -1]) {
      const wheel = buildWheel(wheelRadius, wheelThickness);
      wheel.position.set(xSign * wheelX, wheelRadius, zSign * wheelZ);
      group.add(wheel);
      wheels.push(wheel);
    }
  }

  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return { group, wheels, dims: CAR_DIMENSIONS };
}
