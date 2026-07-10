import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { addTrees, addLightPoles } from '../effects/scenery';

export interface TrackConfig {
  id: string;
  name: string;
  /** Closed centerline control points in the XZ plane. */
  points: [number, number][];
  width: number;
  laps: number;
  /** Curve parameters (0..1) where launch ramps sit. */
  jumpPadsAt: number[];
  /** Curve parameters where forward-boost strips sit. */
  boostPadsAt: number[];
  /** Curve parameters where nitro pickups float. */
  nitroPickupsAt: number[];
  buildings: boolean;
}

export const TRACKS: Record<string, TrackConfig> = {
  city: {
    id: 'city',
    name: 'CITY GP',
    // A stadium-ish GP layout: two long straights, a fast sweeper, a chicane and a hairpin.
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
  },
};

const CHECKPOINT_COUNT = 12;
const WALL_HEIGHT = 1.6;

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
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#26282d';
  ctx.fillRect(0, 0, 128, 256);
  // Speckle for asphalt grain.
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.15)';
    ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
  }
  // Center dashes.
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(61, 20, 6, 60);
  ctx.fillRect(61, 150, 6, 60);
  // Edge lines.
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillRect(3, 0, 4, 256);
  ctx.fillRect(121, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildWindowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14161c';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 122; y += 12) {
    for (let x = 6; x < 58; x += 10) {
      const lit = Math.random() < 0.35;
      ctx.fillStyle = lit ? (Math.random() > 0.5 ? '#ffd98a' : '#9fd0ff') : '#20232b';
      ctx.fillRect(x, y, 6, 8);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Spline-based closed race circuit: generates the road ribbon mesh, guardrail physics/visuals,
 * checkpoints for lap/position tracking, and gameplay pads (jump launchers, boost strips,
 * nitro pickups). Physics ground is one flat plane — the road itself is flat; jumps are
 * velocity launches, which keeps the yaw-locked chassis physics stable.
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

    // Surroundings: grass plane, buildings/trees, floodlights.
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(160, 48),
      new THREE.MeshStandardMaterial({ color: 0x17301e, roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.05;
    grass.receiveShadow = true;
    scene.add(grass);

    if (config.buildings) this.buildBuildings();
    addTrees(scene, 78, 130, 40);
    addLightPoles(scene, 74, 10);
  }

  private sampleFrame(t: number) {
    const pos = this.curve.getPointAt(t);
    const tangent = this.curve.getTangentAt(t).setY(0).normalize();
    const left = new THREE.Vector3(-tangent.z, 0, tangent.x);
    return { pos, tangent, left };
  }

  private buildRoad() {
    const SEGMENTS = 320;
    const half = this.config.width / 2;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = (i % SEGMENTS) / SEGMENTS;
      const { pos, left } = this.sampleFrame(t);
      positions.push(pos.x + left.x * half, 0.01, pos.z + left.z * half);
      positions.push(pos.x - left.x * half, 0.01, pos.z - left.z * half);
      uvs.push(0, i * 0.35, 1, i * 0.35);
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
    // DoubleSide: the ribbon's triangle winding depends on the curve's direction of travel, so
    // one-sided rendering can leave the whole road invisible from above on clockwise tracks.
    const mat = new THREE.MeshStandardMaterial({ map: buildAsphaltTexture(), roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);
  }

  private buildWalls(world: CANNON.World | null) {
    const SEGMENTS = 130;
    const half = this.config.width / 2 + 0.5;
    const railGeo = new THREE.BoxGeometry(1, WALL_HEIGHT * 0.5, 1); // scaled per-instance
    const railMat = new THREE.MeshStandardMaterial({ color: 0x8a8d94, roughness: 0.7, metalness: 0.2 });
    const count = SEGMENTS * 2;
    const mesh = new THREE.InstancedMesh(railGeo, railMat, count);
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
        dummy.scale.set(len, 1, 0.25);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);

        if (world) {
          const body = new CANNON.Body({ mass: 0 });
          body.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, WALL_HEIGHT / 2, 0.15)));
          body.position.set(mid.x, WALL_HEIGHT / 2, mid.z);
          body.quaternion.setFromEuler(0, -angle, 0);
          (body as unknown as { userData?: unknown }).userData = { wall: true };
          world.addBody(body);
        }
      }
    }
    mesh.castShadow = true;
    this.scene.add(mesh);
  }

  private buildPads() {
    for (const t of this.config.jumpPadsAt) {
      const { pos, tangent } = this.sampleFrame(t);
      this.jumpPads.push({ pos: pos.clone(), dir: tangent.clone(), radius: 4 });
      const ramp = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 0.5, this.config.width * 0.7),
        new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff8800, emissiveIntensity: 0.5, roughness: 0.4 }),
      );
      ramp.position.set(pos.x, 0.1, pos.z);
      ramp.rotation.y = -Math.atan2(tangent.z, tangent.x);
      ramp.rotation.z = 0.12;
      this.scene.add(ramp);
    }
    for (const t of this.config.boostPadsAt) {
      const { pos, tangent } = this.sampleFrame(t);
      this.boostPads.push({ pos: pos.clone(), dir: tangent.clone(), radius: 4 });
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(6, this.config.width * 0.7),
        new THREE.MeshStandardMaterial({ color: 0x30d0ff, emissive: 0x1090ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.75 }),
      );
      strip.rotation.x = -Math.PI / 2;
      strip.rotation.z = -Math.atan2(tangent.z, tangent.x);
      strip.position.set(pos.x, 0.03, pos.z);
      this.scene.add(strip);
    }
    for (const t of this.config.nitroPickupsAt) {
      const { pos } = this.sampleFrame(t);
      const g = new THREE.Group();
      const icon = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.5, 0),
        new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x40ff70, emissiveIntensity: 1.4, roughness: 0.2 }),
      );
      icon.position.y = 1;
      g.add(icon);
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
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2, this.config.width), new THREE.MeshBasicMaterial({ map: tex }));
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = -Math.atan2(tangent.z, tangent.x);
    line.position.set(pos.x, 0.02, pos.z);
    this.scene.add(line);

    // Overhead gantry.
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6 });
    for (const side of [1, -1]) {
      const p = pos.clone().addScaledVector(left, side * (this.config.width / 2 + 1));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), poleMat);
      pole.position.set(p.x, 3, p.z);
      this.scene.add(pole);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, this.config.width + 2), new THREE.MeshStandardMaterial({ color: 0xcc2222, emissive: 0x881111, emissiveIntensity: 0.5 }));
    beam.position.set(pos.x, 5.8, pos.z);
    beam.rotation.y = -Math.atan2(tangent.z, tangent.x);
    this.scene.add(beam);
  }

  private buildBuildings() {
    const windowTex = buildWindowTexture();
    const COUNT = 46;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: windowTex, color: 0xaeb2bc, roughness: 0.8 });
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < COUNT; i++) {
      const t = i / COUNT;
      const { pos, left } = this.sampleFrame(t);
      const side = i % 3 === 0 ? 1 : -1; // mostly outside the track
      const dist = this.config.width / 2 + 14 + Math.random() * 26;
      const p = pos.clone().addScaledVector(left, side * dist);
      // Keep buildings from landing on another part of the track (small circuits fold close).
      let tooClose = false;
      for (let j = 0; j < 24; j++) {
        if (this.curve.getPointAt(j / 24).distanceTo(p) < this.config.width / 2 + 8) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) {
        dummy.scale.setScalar(0.001);
        dummy.position.set(0, -50, 0);
      } else {
        const w = 6 + Math.random() * 8;
        const h = 8 + Math.random() * 26;
        dummy.position.set(p.x, h / 2, p.z);
        dummy.scale.set(w, h, w);
        dummy.rotation.set(0, Math.random() * Math.PI, 0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(mesh);
  }

  /** Finds the curve parameter closest to a world position via local search around a hint (cheap, called per car per frame). */
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
        p.mesh.children[0].rotation.y += dt * 2.4;
        p.mesh.children[0].position.y = 1 + Math.sin(time * 2.2 + p.pos.x) * 0.15;
      }
    }
  }

  /** Consumes a pickup if the given position touches one; returns true when collected. */
  tryCollectPickup(x: number, z: number, time: number): boolean {
    for (const p of this.nitroPickups) {
      if (!p.active) continue;
      const dx = x - p.pos.x;
      const dz = z - p.pos.z;
      if (dx * dx + dz * dz < 2.2 * 2.2) {
        p.active = false;
        p.mesh.visible = false;
        p.respawnAt = time + 6;
        return true;
      }
    }
    return false;
  }
}
