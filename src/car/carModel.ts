import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Smooths a faceted ExtrudeGeometry by welding coincident vertices and averaging normals — fakes the rounded body panels of the reference photos without adding real curve geometry. */
function smoothGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const merged = mergeVertices(geo);
  merged.computeVertexNormals();
  return merged;
}

export interface CarDimensions {
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
}

// Real C204 coupe proportions (length/width/height/wheelbase-derived track).
export const CAR_DIMENSIONS: CarDimensions = {
  length: 4.59,
  width: 1.78,
  height: 1.4,
  wheelRadius: 0.35,
};

/** Builds a shape from normalized (fraction of halfL, fraction of height) points, auto-fixing winding so extrude normals always face outward. */
function shapeFromPoints(pts: [number, number][], halfL: number, height: number): THREE.Shape {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  const ordered = area < 0 ? [...pts].reverse() : pts;
  const shape = new THREE.Shape();
  ordered.forEach(([fx, fy], i) => {
    const x = fx * halfL;
    const y = fy * height;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return shape;
}

/** Twin-louvre chrome grille texture with a subtle brushed-metal gradient per slat. */
function buildGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#08080a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const louvreCount = 2;
  const gap = 12;
  const louvreHeight = (canvas.height - gap * (louvreCount + 1)) / louvreCount;
  for (let i = 0; i < louvreCount; i++) {
    const y = gap + i * (louvreHeight + gap);
    const grad = ctx.createLinearGradient(0, y, 0, y + louvreHeight);
    grad.addColorStop(0, '#fafbfc');
    grad.addColorStop(0.4, '#aeb2ba');
    grad.addColorStop(0.52, '#7d818a');
    grad.addColorStop(0.6, '#9599a1');
    grad.addColorStop(1, '#f0f1f3');
    ctx.fillStyle = grad;
    ctx.fillRect(4, y, canvas.width - 8, louvreHeight);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Flat chrome ring + three-pointed star badge, drawn as a texture so it reads as a clean 2D emblem instead of floating 3D geometry. */
function buildStarBadgeTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.46;

  ctx.clearRect(0, 0, size, size);
  const ringGrad = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r);
  ringGrad.addColorStop(0, '#c9cdd3');
  ringGrad.addColorStop(0.75, '#eef0f2');
  ringGrad.addColorStop(1, '#8a8e96');
  ctx.fillStyle = ringGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#111214';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#eef0f2';
  ctx.lineWidth = size * 0.045;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const angle = -Math.PI / 2 + (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * r * 0.62, cy + Math.sin(angle) * r * 0.62);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Deep-concave multi-spoke alloy wheel styled after the reference photos' aftermarket rims. */
function buildWheel(radius: number, thickness: number): THREE.Group {
  const wheel = new THREE.Group();

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92, metalness: 0.0 });
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, 28), tireMat);
  tire.rotation.z = Math.PI / 2;
  wheel.add(tire);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd7d9dd, roughness: 0.35, metalness: 0.6 });
  const barrelRadius = radius * 0.74;
  // Deep concave dish: front face is recessed toward the hub, like the reference wheels.
  const dishFront = new THREE.Mesh(new THREE.CylinderGeometry(barrelRadius, barrelRadius * 0.9, thickness * 0.5, 28), rimMat);
  dishFront.rotation.z = Math.PI / 2;
  dishFront.position.x = thickness * 0.28;
  wheel.add(dishFront);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(barrelRadius, thickness * 0.06, 10, 28), rimMat);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = thickness * 0.5;
  wheel.add(lip);

  const hubMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.4, metalness: 0.5 });
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.15, radius * 0.15, thickness * 1.1, 16), hubMat);
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);

  const spokeCount = 5;
  const spokeGeo = new THREE.BoxGeometry(thickness * 0.42, barrelRadius * 0.95, radius * 0.15);
  for (let i = 0; i < spokeCount; i++) {
    for (const twist of [-1, 1]) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      const angle = (i / spokeCount) * Math.PI * 2 + (twist > 0 ? 0.2 : -0.05);
      spoke.rotation.x = angle;
      spoke.position.set(thickness * 0.3, Math.cos(angle) * barrelRadius * 0.45, Math.sin(angle) * barrelRadius * 0.45 * 0);
      wheel.add(spoke);
    }
  }

  wheel.rotation.y = Math.PI / 2;
  return wheel;
}

export interface CarModel {
  group: THREE.Group;
  wheels: THREE.Group[];
  dims: CarDimensions;
}

export function createCarModel(paintColor = 0x9199a1): CarModel {
  const { length, width, height, wheelRadius } = CAR_DIMENSIONS;
  const group = new THREE.Group();
  const halfL = length / 2;
  const bodyH = height * 0.8;

  const paintMat = new THREE.MeshStandardMaterial({ color: paintColor, roughness: 0.45, metalness: 0.35 });
  const blackTrimMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.55, metalness: 0.25 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.86 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe4e6e9, roughness: 0.25, metalness: 0.75 });

  // Coupe silhouette: many points so the straight-line extrude reads as a smooth curve, not a facet.
  const bodyPts: [number, number][] = [
    [-1.0, 0.05], [-1.0, 0.28], [-0.94, 0.42], [-0.84, 0.52], [-0.72, 0.66], [-0.6, 0.78],
    [-0.48, 0.88], [-0.34, 0.95], [-0.18, 0.99], [0.0, 1.0], [0.16, 0.99], [0.3, 0.95],
    [0.42, 0.86], [0.52, 0.72], [0.6, 0.58], [0.7, 0.46], [0.8, 0.38], [0.9, 0.32],
    [1.0, 0.27], [1.0, 0.05],
  ];
  const bodyGeo = smoothGeometry(new THREE.ExtrudeGeometry(shapeFromPoints(bodyPts, halfL, bodyH), {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 1,
  }));
  bodyGeo.center();
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.rotation.y = Math.PI / 2;
  body.position.y = wheelRadius * 0.6;
  group.add(body);

  // Character line: a thin shadow-line crease along the beltline for visual depth.
  const creaseGeo = new THREE.BoxGeometry(length * 0.74, 0.012, width + 0.006);
  const creaseMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.6, transparent: true, opacity: 0.16 });
  const crease = new THREE.Mesh(creaseGeo, creaseMat);
  crease.position.set(-length * 0.02, wheelRadius * 0.6 + bodyH * 0.42, 0);
  group.add(crease);

  // Greenhouse / glass band, tapering toward the rear like a coupe fastback.
  const glassPts: [number, number][] = [
    [-0.5, 0.56], [-0.42, 0.7], [-0.3, 0.82], [-0.14, 0.9], [0.04, 0.94], [0.22, 0.92],
    [0.36, 0.84], [0.44, 0.7], [0.4, 0.56],
  ];
  const glassGeo = smoothGeometry(new THREE.ExtrudeGeometry(shapeFromPoints(glassPts, halfL, bodyH), { depth: width * 0.92, bevelEnabled: false, curveSegments: 1 }));
  glassGeo.center();
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.rotation.y = Math.PI / 2;
  glass.position.set(0.001, wheelRadius * 0.6, 0);
  group.add(glass);

  // Front grille: chrome frame + twin louvres + big center star.
  const grilleTex = buildGrilleTexture();
  const grilleMat = new THREE.MeshStandardMaterial({ map: grilleTex, roughness: 0.28, metalness: 0.85 });
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.46, height * 0.3), grilleMat);
  grille.position.set(halfL - 0.015, wheelRadius * 0.6 + height * 0.19, 0);
  grille.rotation.y = -Math.PI / 2;
  group.add(grille);

  // Center star badge as a flat textured disc — flush against the grille, reads cleanly at a
  // distance instead of the "floating 3D wheel" look a ring-plus-spokes assembly gave.
  const badgeTex = buildStarBadgeTexture();
  const badgeMat = new THREE.MeshStandardMaterial({ map: badgeTex, transparent: true, roughness: 0.25, metalness: 0.7 });
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.22, width * 0.22), badgeMat);
  badge.rotation.y = -Math.PI / 2;
  badge.position.set(halfL - 0.008, wheelRadius * 0.6 + height * 0.19, 0);
  group.add(badge);

  // AMG-style front apron: black lower bumper with center + side intakes, splitter lip.
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.28, height * 0.22, width * 0.98), blackTrimMat);
  apron.position.set(halfL - 0.13, wheelRadius * 0.34, 0);
  group.add(apron);

  const centerIntake = new THREE.Mesh(new THREE.BoxGeometry(0.05, height * 0.13, width * 0.32), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8 }));
  centerIntake.position.set(halfL - 0.01, wheelRadius * 0.3, 0);
  group.add(centerIntake);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, width * 1.04), chromeMat);
  splitter.position.set(halfL - 0.01, wheelRadius * 0.1, 0);
  group.add(splitter);

  // Headlamps: angled trapezoid clear lens + LED accent strip below (matches the lit reference photo).
  const headlightMat = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.9 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xcfe8ff, emissive: 0x7fc8ff, emissiveIntensity: 2.2, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x3a0708, emissive: 0xb01018, emissiveIntensity: 1.4, roughness: 0.3 });
  for (const side of [-1, 1]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.15, height * 0.15, width * 0.3), headlightMat);
    headlight.position.set(halfL - 0.23, wheelRadius * 0.6 + height * 0.23, side * width * 0.32);
    group.add(headlight);

    const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, width * 0.26), ledMat);
    led.position.set(halfL - 0.14, wheelRadius * 0.6 + height * 0.15, side * width * 0.32);
    group.add(led);

    const sideIntake = new THREE.Mesh(new THREE.BoxGeometry(0.2, height * 0.1, width * 0.16), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8 }));
    sideIntake.position.set(halfL - 0.15, wheelRadius * 0.32, side * width * 0.4);
    group.add(sideIntake);

    // Mirrors.
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.07), paintMat);
    mirror.position.set(halfL * 0.16, wheelRadius * 0.6 + height * 0.58, side * (width / 2 + 0.04));
    group.add(mirror);

    // Taillights.
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, height * 0.2, width * 0.28), tailMat);
    tail.position.set(-halfL + 0.09, wheelRadius * 0.6 + height * 0.32, side * width * 0.34);
    group.add(tail);

    // Exhaust tips.
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 12), chromeMat);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(-halfL + 0.02, wheelRadius * 0.32, side * width * 0.28);
    group.add(exhaust);
  }

  // Rear diffuser insert.
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.22, height * 0.16, width * 0.9), blackTrimMat);
  diffuser.position.set(-halfL + 0.11, wheelRadius * 0.3, 0);
  group.add(diffuser);

  // Small trunk lip spoiler.
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, width * 0.7), blackTrimMat);
  spoiler.position.set(-halfL + 0.28, wheelRadius * 0.6 + bodyH * 1.0, 0);
  group.add(spoiler);

  // Side skirts.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(length * 0.56, 0.07, width * 1.02), blackTrimMat);
  skirt.position.set(0, wheelRadius * 0.28, 0);
  group.add(skirt);

  // Soft contact shadow: real-time shadows alone leave low-poly cars looking like they hover;
  // a dark radial blob under the chassis grounds them at almost zero cost.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const sctx = shadowCanvas.getContext('2d')!;
  const sgrad = sctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  sgrad.addColorStop(0, 'rgba(0,0,0,0.42)');
  sgrad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = sgrad;
  sctx.fillRect(0, 0, 64, 64);
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(length * 1.15, width * 1.5),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.02;
  contactShadow.renderOrder = 1;
  group.add(contactShadow);

  // Wheels.
  const wheelThickness = width * 0.22;
  const wheels: THREE.Group[] = [];
  const wheelX = length * 0.32;
  const wheelZ = width / 2 - wheelThickness * 0.28;
  for (const xSign of [1, -1]) {
    for (const zSign of [1, -1]) {
      const wheel = buildWheel(wheelRadius, wheelThickness);
      wheel.position.set(xSign * wheelX, wheelRadius, zSign * wheelZ);
      if (zSign < 0) wheel.rotation.y += Math.PI;
      group.add(wheel);
      wheels.push(wheel);
    }
  }

  // Wheel arch shadowing (subtle dark blend at the arch to ground the wheels visually).
  const archMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.8, transparent: true, opacity: 0.12 });
  for (const xSign of [1, -1]) {
    for (const zSign of [1, -1]) {
      const arch = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius * 1.08, wheelRadius * 0.22, 8, 16, Math.PI), archMat);
      arch.rotation.z = Math.PI;
      arch.rotation.y = Math.PI / 2;
      arch.position.set(xSign * wheelX, wheelRadius * 1.05, zSign * (width / 2 + 0.01));
      group.add(arch);
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
