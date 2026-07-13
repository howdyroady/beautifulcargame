import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export interface CarDimensions {
  length: number;
  width: number;
  height: number;
  wheelRadius: number;
}

export const CAR_DIMENSIONS: CarDimensions = {
  length: 4.62,
  width: 1.86, // wider stance
  height: 1.24, // lower, sportier roofline
  wheelRadius: 0.37,
};

export interface CarModel {
  group: THREE.Group;
  wheels: THREE.Group[];
  dims: CarDimensions;
  /** Toggle brake lights on/off. */
  setBrakeLights?: (on: boolean) => void;
  /** Toggle nitro exhaust glow. */
  setNitroGlow?: (on: boolean) => void;
}

/* ─── Textures ─── */

function buildGrilleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#080810';
  ctx.fillRect(0, 0, 256, 128);
  for (const y of [16, 72]) {
    const grad = ctx.createLinearGradient(0, y, 0, y + 38);
    grad.addColorStop(0, '#f0f2f5');
    grad.addColorStop(0.45, '#9ea4ae');
    grad.addColorStop(0.55, '#7e848e');
    grad.addColorStop(1, '#e5e8ec');
    ctx.fillStyle = grad;
    ctx.fillRect(6, y, 244, 38);
  }
  // Center star
  const cx = 128, cy = 64;
  ctx.fillStyle = '#0a0c10';
  ctx.beginPath();
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#eef0f4';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 31, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * 28, cy + Math.sin(a) * 28);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ─── Wheels ─── */

function buildWheel(radius: number, width: number): THREE.Group {
  const wheel = new THREE.Group();

  const tireMat = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.92 });
  const tire = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.78, radius * 0.24, 14, 30), tireMat);
  wheel.add(tire);

  const rimMat = new THREE.MeshPhysicalMaterial({
    color: 0xd4d8de,
    roughness: 0.18,
    metalness: 0.96,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15,
  });
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width * 0.7, 26, 1, true),
    rimMat,
  );
  barrel.rotation.x = Math.PI / 2;
  wheel.add(barrel);

  // Brake disc + caliper
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.46, radius * 0.46, 0.035, 22),
    new THREE.MeshStandardMaterial({ color: 0x484c54, roughness: 0.3, metalness: 0.85 }),
  );
  disc.rotation.x = Math.PI / 2;
  disc.position.z = -width * 0.1;
  wheel.add(disc);
  const caliper = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 0.3, radius * 0.52, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xcc2020, roughness: 0.35 }),
  );
  caliper.position.set(radius * 0.42, 0, -width * 0.08);
  wheel.add(caliper);

  const spokeGeo = new THREE.BoxGeometry(radius * 0.09, radius * 0.58, width * 0.26);
  for (let i = 0; i < 10; i++) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    const a = (i / 10) * Math.PI * 2;
    spoke.position.set(Math.sin(a) * radius * 0.34, Math.cos(a) * radius * 0.34, width * 0.16);
    spoke.rotation.z = -a;
    spoke.rotation.y = 0.28;
    wheel.add(spoke);
  }

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.14, radius * 0.14, width * 0.32, 14),
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.25, metalness: 0.75 }),
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.z = width * 0.16;
  wheel.add(cap);

  return wheel;
}

/* ─── Body shape helpers ─── */

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

/* ─── Main car builder ─── */

export function createCarModel(paintColor = 0x9199a1): CarModel {
  const { length, width, height, wheelRadius } = CAR_DIMENSIONS;
  const group = new THREE.Group();
  const halfL = length / 2;
  const bodyH = height * 0.8;
  // Underbody clearance: profile y=0 sits this far above the ground.
  const bodyLift = 0.12;
  /** Profile-fraction → world height. */
  const py = (f: number) => f * bodyH + bodyLift;

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    roughness: 0.25,
    metalness: 0.7,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    reflectivity: 0.9,
  });
  const blackTrimMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0.3 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x080c14,
    roughness: 0.04,
    metalness: 0.2,
    transparent: true,
    opacity: 0.88,
    clearcoat: 1,
  });
  const chromeMat = new THREE.MeshPhysicalMaterial({
    color: 0xe8eaee,
    roughness: 0.1,
    metalness: 1,
    clearcoat: 0.6,
  });

  // Coupe side profile (rear → roof → nose). Profile x IS the car's length axis
  // (world X, +X = nose) and the shape is extruded along Z across the car's
  // width — no rotation involved. The previous version rotated the extrusion
  // 90°, which laid the 4.6 m silhouette ACROSS the driving direction: the car
  // rendered as a dome ~4.6 m wide and ~1.8 m long over correctly-placed wheels.
  const bodyPts: [number, number][] = [
    [-1.0, 0.07],            // bottom rear
    [-1.0, 0.34],            // tail face
    [-0.96, 0.44],           // ducktail lip
    [-0.86, 0.46],           // decklid
    [-0.64, 0.48],           // decklid end
    [-0.56, 0.53],           // C-pillar base
    [-0.42, 0.72],           // rear glass slope
    [-0.28, 0.88],           // C-pillar top
    [-0.15, 0.96],           // roof rear
    [-0.02, 1.0],            // roof crown (over the cabin)
    [0.1, 0.96],             // windshield top
    [0.24, 0.72],            // windshield
    [0.32, 0.6],             // cowl
    [0.46, 0.56],            // hood rear
    [0.74, 0.5],             // hood
    [0.9, 0.46],             // nose top
    [1.0, 0.42],             // nose lip
    [1.0, 0.07],             // bottom front
  ];
  // Bevel adds bevelSize on every side, so shrink the extrusion depth to keep
  // the finished body exactly `width` wide.
  const bevel = 0.06;
  const bodyDepth = width - 2 * bevel;
  const bodyGeoRaw = new THREE.ExtrudeGeometry(shapeFrom(bodyPts, halfL, bodyH), {
    depth: bodyDepth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 6,
    curveSegments: 1,
  });
  // Tumblehome: pinch everything above the beltline inward for a cabin that is
  // visibly narrower than the fenders.
  taperAboveBelt(bodyGeoRaw, bodyH * 0.5, bodyH, bodyDepth, 0.34);
  const bodyGeo = mergeVertices(bodyGeoRaw);
  bodyGeo.computeVertexNormals();
  bodyGeo.translate(0, 0, -bodyDepth / 2); // center across the width
  const body = new THREE.Mesh(bodyGeo, paintMat);
  body.position.y = bodyLift;
  group.add(body);

  // Greenhouse glass band, following the roofline just inside the body skin.
  const glassPts: [number, number][] = [
    [-0.52, 0.52],
    [-0.4, 0.7], [-0.27, 0.85], [-0.14, 0.93], [-0.02, 0.965],
    [0.09, 0.93], [0.22, 0.7], [0.27, 0.55],
  ];
  const glassDepth = width * 0.8;
  const glassGeoRaw = new THREE.ExtrudeGeometry(shapeFrom(glassPts, halfL, bodyH), {
    depth: glassDepth,
    bevelEnabled: false,
    curveSegments: 1,
  });
  taperAboveBelt(glassGeoRaw, bodyH * 0.5, bodyH, glassDepth, 0.3);
  const glassGeo = mergeVertices(glassGeoRaw);
  glassGeo.computeVertexNormals();
  glassGeo.translate(0, 0, -glassDepth / 2);
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.y = bodyLift + 0.01;
  group.add(glass);

  // Hood power domes
  for (const side of [-1, 1]) {
    const dome = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.7, 4, 8), paintMat);
    dome.rotation.z = Math.PI / 2;
    dome.rotation.y = 0.06 * side;
    dome.position.set(halfL * 0.58, py(0.54), side * width * 0.15);
    group.add(dome);
  }

  // Front grille (on the nose face, which sits at x ≈ halfL + bevel)
  const grille = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.5, height * 0.2),
    new THREE.MeshStandardMaterial({ map: buildGrilleTexture(), roughness: 0.25, metalness: 0.85 }),
  );
  grille.position.set(halfL + bevel + 0.005, py(0.27), 0);
  grille.rotation.y = Math.PI / 2;
  group.add(grille);

  const intake = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, height * 0.11, width * 0.56),
    new THREE.MeshStandardMaterial({ color: 0x040406, roughness: 0.7 }),
  );
  intake.position.set(halfL + 0.02, py(0.12), 0);
  group.add(intake);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, width * 0.98), blackTrimMat);
  splitter.position.set(halfL - 0.02, py(0.035), 0);
  group.add(splitter);

  // Lights, tails, side details, exhaust
  const headlightMat = new THREE.MeshPhysicalMaterial({
    color: 0xb0bccc,
    roughness: 0.12,
    metalness: 0.4,
    transparent: true,
    opacity: 0.75,
    clearcoat: 1,
  });
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0xd6ecff,
    emissive: 0x9fd4ff,
    emissiveIntensity: 3.0,
    roughness: 0.25,
  });

  // Brake lights (togglable emissive)
  const brakeLightMeshes: THREE.Mesh[] = [];
  const tailOffMat = new THREE.MeshStandardMaterial({
    color: 0x2a0608,
    emissive: 0x600810,
    emissiveIntensity: 0.6,
    roughness: 0.3,
  });
  const tailOnMat = new THREE.MeshStandardMaterial({
    color: 0xff1020,
    emissive: 0xff0818,
    emissiveIntensity: 3.5,
    roughness: 0.2,
  });

  // Nitro exhaust glow meshes
  const nitroGlowMeshes: THREE.Mesh[] = [];
  const nitroOffMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  const nitroOnMat = new THREE.MeshStandardMaterial({
    color: 0x4090ff,
    emissive: 0x2060ff,
    emissiveIntensity: 4.0,
    roughness: 0.2,
  });

  for (const side of [-1, 1]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.12, height * 0.09, width * 0.22), headlightMat);
    headlight.position.set(halfL - 0.02, py(0.36), side * width * 0.3);
    headlight.rotation.y = side * 0.1;
    group.add(headlight);

    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, width * 0.22), ledMat);
    drl.position.set(halfL + 0.02, py(0.315), side * width * 0.31);
    drl.rotation.y = side * 0.12;
    group.add(drl);

    const sideIntake = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, height * 0.1, width * 0.14),
      new THREE.MeshStandardMaterial({ color: 0x040406, roughness: 0.75 }),
    );
    sideIntake.position.set(halfL - 0.16, py(0.15), side * width * 0.36);
    group.add(sideIntake);

    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.09), paintMat);
    mirror.position.set(halfL * 0.24, py(0.62), side * (width / 2 + 0.05));
    group.add(mirror);

    // Tail lights (on the tail face)
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, height * 0.11, width * 0.26), tailOffMat);
    tail.position.set(-halfL - 0.02, py(0.24), side * width * 0.28);
    tail.rotation.y = -side * 0.1;
    group.add(tail);
    brakeLightMeshes.push(tail);

    // Quad exhaust
    for (const inner of [0, 1]) {
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.14, 16), chromeMat);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(-halfL - 0.05, py(0.09), side * width * (0.26 + inner * 0.11));
      group.add(tip);

      // Nitro glow inside exhaust tip
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 12), nitroOffMat);
      glow.rotation.z = Math.PI / 2;
      glow.position.set(-halfL - 0.07, py(0.09), side * width * (0.26 + inner * 0.11));
      group.add(glow);
      nitroGlowMeshes.push(glow);
    }
  }

  // Rear diffuser + ducktail spoiler on the decklid
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.2, height * 0.11, width * 0.8), blackTrimMat);
  diffuser.position.set(-halfL + 0.04, py(0.05), 0);
  group.add(diffuser);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.045, width * 0.58), paintMat);
  spoiler.position.set(-halfL * 0.93, py(0.475), 0);
  group.add(spoiler);

  // Side skirts: a slim rocker strip between the wheels, tucked under the body —
  // NOT a full-width slab (that read as extra body width from any angle).
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(length * 0.5, 0.1, width * 0.88), blackTrimMat);
  skirt.position.set(0, 0.1, 0);
  group.add(skirt);

  // Underbody LED glow (cyan)
  const underGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(length * 0.62, width * 0.64),
    new THREE.MeshStandardMaterial({
      color: 0x20c0ff,
      emissive: 0x1090cc,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    }),
  );
  underGlow.rotation.x = -Math.PI / 2;
  underGlow.position.y = 0.04;
  underGlow.renderOrder = 1;
  group.add(underGlow);

  // Contact shadow
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 64;
  const sctx = shadowCanvas.getContext('2d')!;
  const sgrad = sctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  sgrad.addColorStop(0, 'rgba(0,0,0,0.45)');
  sgrad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = sgrad;
  sctx.fillRect(0, 0, 64, 64);
  // Keep the shadow halo close to the footprint — an oversized blob makes the
  // whole car read wider than it is, especially from the top-down parking cam.
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(length * 1.08, width * 1.25),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.02;
  contactShadow.renderOrder = 1;
  group.add(contactShadow);

  // Wheels
  const wheels: THREE.Group[] = [];
  const wheelX = length * 0.32;
  const wheelZ = width / 2 - 0.02;
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
  underGlow.castShadow = false;

  return {
    group,
    wheels,
    dims: CAR_DIMENSIONS,
    setBrakeLights: (on: boolean) => {
      const mat = on ? tailOnMat : tailOffMat;
      for (const m of brakeLightMeshes) m.material = mat;
    },
    setNitroGlow: (on: boolean) => {
      const mat = on ? nitroOnMat : nitroOffMat;
      for (const m of nitroGlowMeshes) m.material = mat;
    },
  };
}

/**
 * Player headlight rig: two spotlights + beam cones. Only on the player's car
 * to avoid multiplying lights.
 */
export function attachHeadlights(model: CarModel) {
  const { length, width, height, wheelRadius } = model.dims;
  const halfL = length / 2;
  const y = wheelRadius * 0.6 + height * 0.26;
  for (const side of [-1, 1]) {
    const spot = new THREE.SpotLight(0xeaf4ff, 35, 48, 0.5, 0.5, 1.1);
    spot.position.set(halfL - 0.15, y, side * width * 0.33);
    const target = new THREE.Object3D();
    target.position.set(halfL + 16, 0, side * width * 0.6);
    model.group.add(target);
    spot.target = target;
    spot.castShadow = false;
    model.group.add(spot);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.0, 8, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xbfe0ff,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    cone.rotation.z = -Math.PI / 2;
    cone.position.set(halfL + 3.8, y - 0.3, side * width * 0.33);
    model.group.add(cone);
  }
}
