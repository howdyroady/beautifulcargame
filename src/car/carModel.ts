import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export interface CarDimensions {
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
}

// Real C204 coupe proportions.
export const CAR_DIMENSIONS: CarDimensions = {
  length: 4.59,
  width: 1.78,
  height: 1.4,
  wheelRadius: 0.35,
};

export interface CarModel {
  group: THREE.Group;
  /** Spin these around local Z to roll the wheels. */
  wheels: THREE.Group[];
  dims: CarDimensions;
}

/* ----------------------------- textures ---------------------------------- */

/** Twin-louvre chrome grille with the big center star, drawn as one texture. */
function buildGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, 256, 128);
  for (const y of [18, 74]) {
    const grad = ctx.createLinearGradient(0, y, 0, y + 36);
    grad.addColorStop(0, '#f4f5f7');
    grad.addColorStop(0.45, '#a2a6ae');
    grad.addColorStop(0.55, '#83878f');
    grad.addColorStop(1, '#e9eaec');
    ctx.fillStyle = grad;
    ctx.fillRect(6, y, 244, 36);
  }
  // Center star.
  const cx = 128;
  const cy = 64;
  ctx.fillStyle = '#101114';
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#eef0f2';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 27, cy + Math.sin(a) * 27);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------- wheels ---------------------------------- */

/**
 * AMG-style multi-spoke wheel: torus tire, polished barrel, ten twisted spokes, brake disc
 * with a painted caliper behind the spokes. Face lies in the XY plane, axle along local Z —
 * spin the returned group around Z to roll it.
 */
function buildWheel(radius: number, width: number): THREE.Group {
  const wheel = new THREE.Group();

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.94 });
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.78, radius * 0.24, 12, 28), tireMat);
  wheel.add(tire);

  const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xd8dade, roughness: 0.22, metalness: 0.95, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.7, 24, 1, true), rimMat);
  barrel.rotation.x = Math.PI / 2;
  wheel.add(barrel);

  // Brake disc + caliper visible through the spokes.
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, 0.03, 20),
    new THREE.MeshStandardMaterial({ color: 0x4a4d53, roughness: 0.35, metalness: 0.8 }),
  );
  disc.rotation.x = Math.PI / 2;
  disc.position.z = -width * 0.1;
  wheel.add(disc);
  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.28, radius * 0.5, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xb8b8bc, roughness: 0.4 }),
  );
  caliper.position.set(radius * 0.42, 0, -width * 0.08);
  wheel.add(caliper);

  const spokeGeo = new THREE.BoxGeometry(radius * 0.1, radius * 0.62, width * 0.28);
  for (let i = 0; i < 10; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    const a = (i / 10) * Math.PI * 2;
    spoke.position.set(Math.sin(a) * radius * 0.34, Math.cos(a) * radius * 0.34, width * 0.16);
    spoke.rotation.z = -a;
    spoke.rotation.y = 0.28; // concave twist like the reference rims
    wheel.add(spoke);
  }

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.13, radius * 0.13, width * 0.32, 14),
    new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.3, metalness: 0.7 }),
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.z = width * 0.16;
  wheel.add(cap);

  return wheel;
}

/* -------------------------------- body ----------------------------------- */

function shapeFrom(pts: [number, number][], halfL: number, height: number): THREE.Shape {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    area += x0 * y1 - x1 * y0;
  }
  const ordered = area < 0 ? [...pts].reverse() : pts;
  const shape = new THREE.Shape();
  ordered.forEach(([fx, fy], i) => {
    if (i === 0) shape.moveTo(fx * halfL, fy * height);
    else shape.lineTo(fx * halfL, fy * height);
  });
  shape.closePath();
  return shape;
}

/**
 * Applies "tumblehome": tapers the extruded body inward above the beltline so the greenhouse
 * leans in like real bodywork instead of being a vertical-walled slab.
 */
function taperAboveBelt(geo: THREE.BufferGeometry, beltY: number, topY: number, depth: number, amount: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const mid = depth / 2;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > beltY) {
      const f = 1 - Math.min(1, (y - beltY) / (topY - beltY)) * amount;
      pos.setZ(i, mid + (pos.getZ(i) - mid) * f);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/* --------------------------------- car ----------------------------------- */

export function createCarModel(paintColor = 0x9199a1): CarModel {
  const { length, width, height, wheelRadius } = CAR_DIMENSIONS;
  const group = new THREE.Group();
  const halfL = length / 2;
  const bodyH = height * 0.8;
  const rideY = wheelRadius * 1.0; // body raised so wheels tuck under it instead of poking through the hood

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    roughness: 0.3,
    metalness: 0.6,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const blackTrimMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.55, metalness: 0.25 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0d13, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.88, clearcoat: 1 });
  const chromeMat = new THREE.MeshPhysicalMaterial({ color: 0xe6e8eb, roughness: 0.12, metalness: 1, clearcoat: 0.5 });

  // Dense smooth coupe silhouette (rear → roof → nose).
  const bodyPts: [number, number][] = [
    [-1.0, 0.06], [-1.0, 0.2], [-0.99, 0.32], [-0.95, 0.42], [-0.89, 0.5], [-0.8, 0.57],
    [-0.72, 0.65], [-0.64, 0.74], [-0.55, 0.82], [-0.45, 0.89], [-0.34, 0.94], [-0.22, 0.98],
    [-0.08, 1.0], [0.06, 1.0], [0.18, 0.97], [0.28, 0.92], [0.37, 0.84], [0.44, 0.74],
    [0.5, 0.63], [0.57, 0.53], [0.65, 0.46], [0.74, 0.41], [0.84, 0.37], [0.93, 0.33],
    [1.0, 0.3], [1.0, 0.06],
  ];
  const bodyGeoRaw = new THREE.ExtrudeGeometry(shapeFrom(bodyPts, halfL, bodyH), {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 5,
    curveSegments: 1,
  });
  taperAboveBelt(bodyGeoRaw, bodyH * 0.52, bodyH, width, 0.24);
  const bodyGeo = mergeVertices(bodyGeoRaw);
  bodyGeo.computeVertexNormals();
  bodyGeo.center();
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.rotation.y = Math.PI / 2;
  body.position.y = rideY;
  group.add(body);

  // Greenhouse: dark glass band with the same taper, slightly inset.
  const glassPts: [number, number][] = [
    [-0.52, 0.56], [-0.46, 0.68], [-0.38, 0.78], [-0.28, 0.86], [-0.16, 0.92], [-0.02, 0.95],
    [0.1, 0.94], [0.2, 0.9], [0.3, 0.82], [0.38, 0.7], [0.42, 0.58], [0.36, 0.55], [-0.46, 0.55],
  ];
  const glassGeoRaw = new THREE.ExtrudeGeometry(shapeFrom(glassPts, halfL, bodyH), { depth: width * 0.9, bevelEnabled: false, curveSegments: 1 });
  taperAboveBelt(glassGeoRaw, bodyH * 0.5, bodyH, width * 0.9, 0.22);
  const glassGeo = mergeVertices(glassGeoRaw);
  glassGeo.computeVertexNormals();
  glassGeo.center();
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.rotation.y = Math.PI / 2;
  glass.position.set(0.001, rideY + 0.012, 0);
  group.add(glass);

  // Hood power domes (C63 signature).
  for (const side of [-1, 1]) {
    const dome = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.75, 4, 8), paintMat);
    dome.rotation.z = Math.PI / 2;
    dome.rotation.y = 0.06 * side;
    dome.position.set(halfL * 0.5, rideY + bodyH * 0.4, side * width * 0.16);
    group.add(dome);
  }

  // Front fascia: grille with integrated star + gloss intake + splitter.
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.52, height * 0.3), new THREE.MeshStandardMaterial({ map: buildGrilleTexture(), roughness: 0.3, metalness: 0.8 }));
  grille.position.set(halfL - 0.012, rideY + height * 0.2, 0);
  grille.rotation.y = -Math.PI / 2;
  group.add(grille);

  const intake = new THREE.Mesh(new THREE.BoxGeometry(0.06, height * 0.14, width * 0.6), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.7 }));
  intake.position.set(halfL - 0.02, rideY - height * 0.02, 0);
  group.add(intake);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, width * 1.02), blackTrimMat);
  splitter.position.set(halfL - 0.04, rideY * 0.45, 0);
  group.add(splitter);
  const splitterChrome = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.015, width * 1.02), chromeMat);
  splitterChrome.position.set(halfL - 0.03, rideY * 0.3, 0);
  group.add(splitterChrome);

  // Headlights + LED DRL, taillight bar, side details, quad exhaust.
  const headlightMat = new THREE.MeshPhysicalMaterial({ color: 0xaebacc, roughness: 0.15, metalness: 0.4, transparent: true, opacity: 0.75, clearcoat: 1 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xd6ecff, emissive: 0x9fd4ff, emissiveIntensity: 2.6, roughness: 0.3 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x38070a, emissive: 0xc01018, emissiveIntensity: 1.6, roughness: 0.3 });

  for (const side of [-1, 1]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.1, height * 0.09, width * 0.24), headlightMat);
    headlight.position.set(halfL - 0.09, rideY + height * 0.2, side * width * 0.32);
    headlight.rotation.y = side * 0.12;
    group.add(headlight);

    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, width * 0.24), ledMat);
    drl.position.set(halfL - 0.12, rideY + height * 0.185, side * width * 0.34);
    drl.rotation.y = side * 0.15;
    group.add(drl);

    const sideIntake = new THREE.Mesh(new THREE.BoxGeometry(0.16, height * 0.11, width * 0.15), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.75 }));
    sideIntake.position.set(halfL - 0.1, rideY * 0.85, side * width * 0.4);
    group.add(sideIntake);

    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.09), paintMat);
    mirror.position.set(halfL * 0.2, rideY + height * 0.58, side * (width / 2 + 0.06));
    group.add(mirror);

    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, height * 0.13, width * 0.28), tailMat);
    tail.position.set(-halfL + 0.12, rideY + height * 0.3, side * width * 0.3);
    tail.rotation.y = -side * 0.12;
    group.add(tail);

    // C63 quad exhaust: two chrome tips per side.
    for (const inner of [0, 1]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 14), chromeMat);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(-halfL + 0.02, rideY * 0.6, side * width * (0.3 + inner * 0.11));
      group.add(tip);
    }
  }

  // Rear diffuser + subtle deck spoiler.
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.18, height * 0.14, width * 0.86), blackTrimMat);
  diffuser.position.set(-halfL + 0.08, rideY * 0.55, 0);
  group.add(diffuser);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, width * 0.72), paintMat);
  spoiler.position.set(-halfL + 0.22, rideY + bodyH * 0.99, 0);
  group.add(spoiler);

  // Side skirts.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(length * 0.56, rideY * 0.9, width * 0.99), blackTrimMat);
  skirt.position.set(0, rideY * 0.52, 0);
  group.add(skirt);

  // Soft contact shadow: grounds the car visually at almost zero cost.
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

  // Wheels: face in XY plane, axle along Z — mount left/right, flip the far side outward.
  const wheels: THREE.Group[] = [];
  const wheelX = length * 0.32;
  const wheelZ = width / 2 - 0.03; // tires slightly proud of the body like the widebody look
  for (const xSign of [1, -1]) {
    for (const zSign of [1, -1]) {
      const wheel = buildWheel(wheelRadius, width * 0.24);
      wheel.position.set(xSign * wheelX, wheelRadius, zSign * wheelZ);
      if (zSign < 0) wheel.rotation.y = Math.PI;
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
  contactShadow.castShadow = false;

  return { group, wheels, dims: CAR_DIMENSIONS };
}

/**
 * Player-only headlight rig: two real spotlights plus faint additive beam cones. Kept out of
 * createCarModel so the 5 other cars on track don't multiply the light count.
 */
export function attachHeadlights(model: CarModel) {
  const { length, width, height, wheelRadius } = model.dims;
  const halfL = length / 2;
  const y = wheelRadius * 0.6 + height * 0.26;
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight(0xeaf4ff, 30, 42, 0.5, 0.5, 1.2);
    spot.position.set(halfL - 0.15, y, side * width * 0.33);
    const target = new THREE.Object3D();
    target.position.set(halfL + 14, 0, side * width * 0.6);
    model.group.add(target);
    spot.target = target;
    spot.castShadow = false;
    model.group.add(spot);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 7, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xbfe0ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    cone.rotation.z = -Math.PI / 2;
    cone.position.set(halfL + 3.4, y - 0.3, side * width * 0.33);
    model.group.add(cone);
  }
}
