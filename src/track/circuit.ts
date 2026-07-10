import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { addTrees, addLightPoles, addBillboards } from '../effects/scenery';

export interface TrackConfig {
  id: string;
  name: string;
  points: [number, number][];
  width: number;
  laps: number;
  jumpPadsAt: number[];
  boostPadsAt: number[];
  nitroPickupsAt: number[];
  buildings: boolean;
  groundColor: number;
}

export const TRACKS: Record<string, TrackConfig> = {
  city: {
    id: 'city',
    name: 'CITY GP',
    points: [
      [0, -46], [28, -48], [52, -38], [62, -14], [52, 6], [58, 26], [42, 44],
      [16, 38], [-2, 48], [-28, 44], [-38, 26], [-58, 18], [-62, -6], [-46, -18],
      [-52, -36], [-28, -46],
    ],
    width: 10,
    laps: 3,
    jumpPadsAt: [0.08, 0.55],
    boostPadsAt: [0.3, 0.78],
    nitroPickupsAt: [0.18, 0.42, 0.68, 0.9],
    buildings: true,
    groundColor: 0x12141a,
  },
  serpent: {
    id: 'serpent',
    name: 'SERPENT',
    points: [
      [50, 0], [46, 22], [30, 36], [10, 30], [-4, 14], [-20, 10], [-36, 20], [-50, 12],
      [-52, -8], [-40, -24], [-22, -22], [-8, -12], [4, -22], [22, -38], [42, -30],
    ],
    width: 9,
    laps: 3,
    jumpPadsAt: [0.34, 0.86],
    boostPadsAt: [0.1, 0.58],
    nitroPickupsAt: [0.22, 0.48, 0.72, 0.95],
    buildings: false,
    groundColor: 0x1a2a1e,
  },
  ring: {
    id: 'ring',
    name: 'RING',
    points: Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return [Math.cos(a) * 42, Math.sin(a) * 42] as [number, number];
    }),
    width: 11,
    laps: 3,
    jumpPadsAt: [0.25],
    boostPadsAt: [0.5, 0.95],
    nitroPickupsAt: [0.12, 0.62],
    buildings: false,
    groundColor: 0x152e1a,
  },
  autobahn: {
    id: 'autobahn',
    name: 'AUTOBAHN',
    // Long straights + fast sweepers — Nürburgring-inspired night course.
    points: [
      [0, -55], [30, -58], [60, -50], [78, -30], [80, 0], [74, 20],
      [55, 35], [30, 42], [10, 50], [-15, 55], [-40, 48], [-60, 35],
      [-72, 15], [-75, -10], [-68, -30], [-50, -44], [-25, -52],
    ],
    width: 12,
    laps: 3,
    jumpPadsAt: [0.15, 0.65],
    boostPadsAt: [0.05, 0.35, 0.7, 0.9],
    nitroPickupsAt: [0.1, 0.28, 0.5, 0.75, 0.92],
    buildings: true,
    groundColor: 0x0e1018,
  },
};

const CHECKPOINT_COUNT = 14;
const WALL_HEIGHT = 1.8;

interface Pad {
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  radius: number;
}

interface NitroPickup {
  pos: THREE.Vector3;
  mesh: THREE.Group;
  active: boolean;
  respawnAt: number;
}

function buildAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  // Base dark asphalt
  ctx.fillStyle = '#1e2028';
  ctx.fillRect(0, 0, 256, 512);
  // Asphalt grain/speckle
  for (let i = 0; i < 800; i++) {
    const bright = Math.random() > 0.5;
    ctx.fillStyle = bright ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // Wet-look subtle reflective patches
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * 220;
    const y = Math.random() * 480;
    const r = 10 + Math.random() * 20;
    const g = ctx.createRadialGradient(x + r / 2, y + r / 2, 0, x + r / 2, y + r / 2, r);
    g.addColorStop(0, 'rgba(80,100,130,0.08)');
    g.addColorStop(1, 'rgba(80,100,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, r * 2, r * 2);
  }
  // Center dashed line
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(122, 30, 12, 100);
  ctx.fillRect(122, 200, 12, 100);
  ctx.fillRect(122, 380, 12, 100);
  // Edge lines
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(4, 0, 5, 512);
  ctx.fillRect(247, 0, 5, 512);
  // Red/white curb stripes at edges
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(200,40,30,0.4)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, i * 32, 4, 32);
    ctx.fillRect(252, i * 32, 4, 32);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildWindowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0c0e14';
  ctx.fillRect(0, 0, 128, 256);
  // Window grid with various lit colors
  const windowColors = ['#ffd98a', '#9fd0ff', '#ff9060', '#80ffb0', '#d090ff', '#60c0ff'];
  for (let y = 6; y < 248; y += 14) {
    for (let x = 6; x < 120; x += 12) {
      const lit = Math.random() < 0.4;
      if (lit) {
        ctx.fillStyle = windowColors[Math.floor(Math.random() * windowColors.length)];
        // Slight glow effect
        ctx.globalAlpha = 0.15;
        ctx.fillRect(x - 1, y - 1, 10, 12);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = lit ? (windowColors[Math.floor(Math.random() * windowColors.length)]) : '#181a22';
      ctx.fillRect(x, y, 8, 10);
    }
  }
  // Random LED panel on some floors
  if (Math.random() > 0.5) {
    const py = 20 + Math.floor(Math.random() * 200);
    const ledColor = ['#ff3050', '#1080ff', '#40ff80', '#ff8020'][Math.floor(Math.random() * 4)];
    ctx.fillStyle = ledColor;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(4, py, 120, 20);
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Spline-based closed race circuit with asphalt road, neon guardrails, gameplay pads,
 * checkpoints, and rich environment (buildings, billboards, trees, floodlights).
 */
export class Circuit {
  config: TrackConfig;
  curve: THREE.CatmullRomCurve3;
  checkpoints: THREE.Vector3[] = [];
  jumpPads: Pad[] = [];
  boostPads: Pad[] = [];
  nitroPickups: NitroPickup[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, world: CANNON.World | null, groundMaterial: CANNON.Material | null, config: TrackConfig) {
    this.scene = scene;
    this.config = config;
    this.curve = new THREE.CatmullRomCurve3(
      config.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'catmullrom',
      0.5,
    );

    this.buildRoad();
    this.buildWalls(world);
    this.buildPads();
    this.buildStartLine();
    if (world && groundMaterial) {
      const ground = new CANNON.Body({ mass: 0, material: groundMaterial });
      ground.addShape(new CANNON.Box(new CANNON.Vec3(200, 0.5, 200)));
      ground.position.set(0, -0.5, 0);
      world.addBody(ground);
    }

    for (let i = 0; i < CHECKPOINT_COUNT; i++) {
      this.checkpoints.push(this.curve.getPointAt(i / CHECKPOINT_COUNT));
    }

    // Ground plane
    const groundMesh = new THREE.Mesh(
      new THREE.CircleGeometry(170, 48),
      new THREE.MeshStandardMaterial({ color: config.groundColor, roughness: 0.95, metalness: 0.05 }),
    );
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.position.y = -0.05;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    if (config.buildings) this.buildBuildings();
    addTrees(scene, 80, 140, 50);
    addLightPoles(scene, 76, 12);
    addBillboards(scene, this.curve, config.buildings ? 14 : 8, config.width);
  }

  private sampleFrame(t: number) {
    const pos = this.curve.getPointAt(t);
    const tangent = this.curve.getTangentAt(t).setY(0).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x);
    return { pos, tangent, left };
  }

  private buildRoad() {
    const SEGMENTS = 360;
    const half = this.config.width / 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i % SEGMENTS) / SEGMENTS;
      const { pos, left } = this.sampleFrame(t);
      positions.push(pos.x + left.x * half, 0.01, pos.z + left.z * half);
      positions.push(pos.x - left.x * half, 0.01, pos.z - left.z * half);
      uvs.push(0, i * 0.3, 1, i * 0.3);
      if (i < SEGMENTS) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: buildAsphaltTexture(),
      roughness: 0.82,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  private buildWalls(world: CANNON.World | null) {
    const SEGMENTS = 140;
    const half = this.config.width / 2 + 0.5;
    // Guardrails: carbon-look dark with neon LED strip on top
    const railGeo = new THREE.BoxGeometry(1, WALL_HEIGHT * 0.5, 1);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.55, metalness: 0.35 });
    const count = SEGMENTS * 2;
    const mesh = new THREE.InstancedMesh(railGeo, railMat, count);
    // Neon strip
    const neonGeo = new THREE.BoxGeometry(1, 0.1, 1);
    const neonMat = new THREE.MeshStandardMaterial({
      color: 0x40d0ff,
      emissive: 0x1090ff,
      emissiveIntensity: 2.0,
      roughness: 0.2,
    });
    const neon = new THREE.InstancedMesh(neonGeo, neonMat, count);
    // Bottom red accent
    const redGeo = new THREE.BoxGeometry(1, 0.06, 1);
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xff3030,
      emissive: 0xcc1818,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });
    const redStrip = new THREE.InstancedMesh(redGeo, redMat, count);
    const dummy = new THREE.Object3D();
    let idx = 0;
    for (let i = 0; i < SEGMENTS; i++) {
      const t0 = i / SEGMENTS;
      const t1 = (i + 1) / SEGMENTS;
      for (const side of [1, -1]) {
        const a = this.sampleFrame(t0);
        const b = this.sampleFrame(t1);
        const pa = a.pos.clone().addScaledVector(a.left, side * half);
        const pb = b.pos.clone().addScaledVector(b.left, side * half);
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        const len = pa.distanceTo(pb) + 0.25;
        const angle = Math.atan2(pb.z - pa.z, pb.x - pa.x);

        dummy.position.set(mid.x, WALL_HEIGHT * 0.25, mid.z);
        dummy.rotation.set(0, -angle, 0);
        dummy.scale.set(len, 1, 0.28);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);

        dummy.position.y = WALL_HEIGHT * 0.5 + 0.05;
        dummy.scale.set(len, 1, 0.14);
        dummy.updateMatrix();
        neon.setMatrixAt(idx, dummy.matrix);

        dummy.position.y = 0.03;
        dummy.scale.set(len, 1, 0.14);
        dummy.updateMatrix();
        redStrip.setMatrixAt(idx, dummy.matrix);

        idx++;

        if (world) {
          const body = new CANNON.Body({ mass: 0 });
          body.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, WALL_HEIGHT / 2, 0.16)));
          body.position.set(mid.x, WALL_HEIGHT / 2, mid.z);
          body.quaternion.setFromEuler(0, -angle, 0);
          world.addBody(body);
        }
      }
    }
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.scene.add(neon);
    this.scene.add(redStrip);
  }

  private buildPads() {
    for (const t of this.config.jumpPadsAt) {
      const { pos, tangent } = this.sampleFrame(t);
      this.jumpPads.push({ pos: pos.clone(), dir: tangent.clone(), radius: 4 });
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(3.5, 0.6, this.config.width * 0.7),
        new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff8800, emissiveIntensity: 0.6, roughness: 0.35 }),
      );
      ramp.position.set(pos.x, 0.1, pos.z);
      ramp.rotation.y = -Math.atan2(tangent.z, tangent.x);
      ramp.rotation.z = 0.14;
      this.scene.add(ramp);
      // Chevron markings
      const chevron = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, this.config.width * 0.65),
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: 0xff6600,
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: 0.4,
        }),
      );
      chevron.rotation.x = -Math.PI / 2;
      chevron.position.set(pos.x, 0.42, pos.z);
      chevron.rotation.z = -Math.atan2(tangent.z, tangent.x);
      this.scene.add(chevron);
    }
    for (const t of this.config.boostPadsAt) {
      const { pos, tangent } = this.sampleFrame(t);
      this.boostPads.push({ pos: pos.clone(), dir: tangent.clone(), radius: 4.5 });
      // Animated-looking boost strip with arrow pattern
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(7, this.config.width * 0.7),
        new THREE.MeshStandardMaterial({
          color: 0x20b0ff,
          emissive: 0x1080ff,
          emissiveIntensity: 1.2,
          transparent: true,
          opacity: 0.7,
        }),
      );
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = -Math.atan2(tangent.z, tangent.x);
      strip.position.set(pos.x, 0.03, pos.z);
      this.scene.add(strip);
    }
    for (const t of this.config.nitroPickupsAt) {
      const { pos } = this.sampleFrame(t);
      const g = new THREE.Group();
      // Glowing octahedron pickup
      const icon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.55, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0x40ff70,
          emissiveIntensity: 1.8,
          roughness: 0.15,
        }),
      );
      icon.position.y = 1;
      g.add(icon);
      // Glow ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.7, 0.04, 8, 24),
        new THREE.MeshStandardMaterial({
          color: 0x40ff70,
          emissive: 0x20dd50,
          emissiveIntensity: 2.0,
          roughness: 0.2,
        }),
      );
      ring.position.y = 1;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.position.copy(pos);
      this.scene.add(g);
      this.nitroPickups.push({ pos: pos.clone(), mesh: g, active: true, respawnAt: 0 });
    }
  }

  private buildStartLine() {
    const { pos, tangent, left } = this.sampleFrame(0);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#111';
      ctx.fillRect(i * 4, 0, 4, 4);
      ctx.fillStyle = i % 2 ? '#111' : '#fff';
      ctx.fillRect(i * 4, 4, 4, 4);
    }
    const tex = new THREE.CanvasTexture(canvas);
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(2, this.config.width),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.atan2(tangent.z, tangent.x);
    line.position.set(pos.x, 0.02, pos.z);
    this.scene.add(line);

    // Overhead gantry with LED panels
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.4 });
    for (const side of [1, -1]) {
      const p = pos.clone().addScaledVector(left, side * (this.config.width / 2 + 1.2));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 7, 8), poleMat);
      pole.position.set(p.x, 3.5, p.z);
      this.scene.add(pole);
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.6, this.config.width + 2.5),
      new THREE.MeshStandardMaterial({ color: 0xdd2222, emissive: 0x991111, emissiveIntensity: 0.7 }),
    );
    beam.position.set(pos.x, 6.8, pos.z);
    beam.rotation.y = -Math.atan2(tangent.z, tangent.x);
    this.scene.add(beam);

    // Green start lights on the beam
    for (const offset of [-2, -1, 0, 1, 2]) {
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({
          color: 0x00ff00,
          emissive: 0x00cc00,
          emissiveIntensity: 2.0,
        }),
      );
      const lPos = pos.clone().addScaledVector(left, offset * 0.6);
      light.position.set(lPos.x, 6.5, lPos.z);
      this.scene.add(light);
    }
  }

  private buildBuildings() {
    const windowTex = buildWindowTexture();
    const COUNT = 55;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: windowTex, color: 0xb0b4be, roughness: 0.75 });
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < COUNT; i++) {
      const t = i / COUNT;
      const { pos, left } = this.sampleFrame(t);
      const side = i % 3 === 0 ? 1 : -1;
      const dist = this.config.width / 2 + 15 + Math.random() * 28;
      const p = pos.clone().addScaledVector(left, side * dist);
      let tooClose = false;
      for (let j = 0; j < 28; j++) {
        if (this.curve.getPointAt(j / 28).distanceTo(p) < this.config.width / 2 + 9) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) {
        dummy.scale.setScalar(0.001);
        dummy.position.set(0, -50, 0);
      } else {
        const w = 6 + Math.random() * 10;
        const h = 10 + Math.random() * 32;
        dummy.position.set(p.x, h / 2, p.z);
        dummy.scale.set(w, h, w);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(mesh);
  }

  nearestT(x: number, z: number, hint: number): number {
    let bestT = hint;
    let bestD = Infinity;
    for (let off = -0.02; off <= 0.05; off += 0.005) {
      let t = hint + off;
      t = ((t % 1) + 1) % 1;
      const p = this.curve.getPointAt(t);
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bestD) {
        bestD = d;
        bestT = t;
      }
    }
    return bestT;
  }

  updatePickups(dt: number, time: number) {
    for (const p of this.nitroPickups) {
      if (!p.active && time >= p.respawnAt) {
        p.active = true;
        p.mesh.visible = true;
      }
      if (p.active) {
        p.mesh.children[0].rotation.y += dt * 2.8;
        p.mesh.children[0].position.y = 1 + Math.sin(time * 2.4 + p.pos.x) * 0.18;
        // Rotate glow ring
        if (p.mesh.children[1]) p.mesh.children[1].rotation.z += dt * 1.5;
      }
    }
  }

  tryCollectPickup(x: number, z: number, time: number): boolean {
    for (const p of this.nitroPickups) {
      if (!p.active) continue;
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      if (dx * dx + dz * dz < 2.5 * 2.5) {
        p.active = false;
        p.mesh.visible = false;
        p.respawnAt = time + 5;
        return true;
      }
    }
    return false;
  }
}
