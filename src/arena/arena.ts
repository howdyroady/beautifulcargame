import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { addTrees, addLightPoles } from '../effects/scenery';

export type HazardType = 'ice' | 'boost';

export interface Hazard {
  type: HazardType;
  x: number;
  z: number;
  radius: number;
  mesh: THREE.Mesh;
}

export const INITIAL_RADIUS = 22;
const MIN_RADIUS = 10;
const SHRINK_INTERVAL = 20; // seconds
const SHRINK_STEP = 3;
const PLATFORM_THICKNESS = 1;

export class Arena {
  radius = INITIAL_RADIUS;
  scene: THREE.Scene;
  world: CANNON.World;
  groundMaterial: CANNON.Material;
  platformMesh: THREE.Group;
  edgeRing: THREE.Mesh;
  body: CANNON.Body;
  hazards: Hazard[] = [];
  private timeSinceShrink = 0;
  private elapsed = 0;

  constructor(scene: THREE.Scene, world: CANNON.World, groundMaterial: CANNON.Material) {
    this.scene = scene;
    this.world = world;
    this.groundMaterial = groundMaterial;

    this.body = new CANNON.Body({ mass: 0, material: groundMaterial });
    this.body.addShape(new CANNON.Cylinder(this.radius, this.radius, PLATFORM_THICKNESS, 32));
    this.body.position.set(0, -PLATFORM_THICKNESS / 2, 0);
    world.addBody(this.body);

    this.platformMesh = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.85, metalness: 0.1 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.9, metalness: 0.1 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius, PLATFORM_THICKNESS, 48), [sideMat, topMat, topMat]);
    disc.position.y = -PLATFORM_THICKNESS / 2;
    disc.receiveShadow = true;
    this.platformMesh.add(disc);

    this.edgeRing = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius, 0.15, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 0.8, roughness: 0.4 }),
    );
    this.edgeRing.rotation.x = Math.PI / 2;
    this.edgeRing.position.y = 0.05;
    this.platformMesh.add(this.edgeRing);

    scene.add(this.platformMesh);

    addLightPoles(scene, this.radius + 4, 8);
    addTrees(scene, this.radius + 6, this.radius + 24, 26);

    this.spawnHazards();
  }

  private spawnHazards() {
    for (const h of this.hazards) this.scene.remove(h.mesh);
    this.hazards = [];
    const count = 3;
    for (let i = 0; i < count; i++) {
      const type: HazardType = i % 2 === 0 ? 'ice' : 'boost';
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * (this.radius * 0.6);
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const radius = type === 'ice' ? 3.2 : 2.2;
      const color = type === 'ice' ? 0x8fd8ff : 0xffb020;
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 24),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.55 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.03, z);
      this.scene.add(mesh);
      this.hazards.push({ type, x, z, radius, mesh });
    }
  }

  /** Returns {friction, boost} effect at a world position. */
  effectAt(x: number, z: number): { friction: number; boostX: number; boostZ: number } {
    for (const h of this.hazards) {
      const dx = x - h.x;
      const dz = z - h.z;
      if (dx * dx + dz * dz <= h.radius * h.radius) {
        if (h.type === 'ice') return { friction: 0.15, boostX: 0, boostZ: 0 };
        if (h.type === 'boost') {
          const len = Math.hypot(x, z) || 1;
          return { friction: 1, boostX: (x / len) * 14, boostZ: (z / len) * 14 };
        }
      }
    }
    return { friction: 1, boostX: 0, boostZ: 0 };
  }

  getHazardSnapshot(): { type: HazardType; x: number; z: number; radius: number }[] {
    return this.hazards.map((h) => ({ type: h.type, x: h.x, z: h.z, radius: h.radius }));
  }

  isOutOfBounds(x: number, y: number, z: number): boolean {
    return y < -4 || Math.hypot(x, z) > this.radius + 6;
  }

  update(dt: number) {
    this.elapsed += dt;
    this.timeSinceShrink += dt;
    if (this.timeSinceShrink >= SHRINK_INTERVAL && this.radius > MIN_RADIUS) {
      this.timeSinceShrink = 0;
      this.shrink();
    }
  }

  private shrink() {
    this.radius = Math.max(MIN_RADIUS, this.radius - SHRINK_STEP);
    this.body.shapes = [];
    this.body.addShape(new CANNON.Cylinder(this.radius, this.radius, PLATFORM_THICKNESS, 32));
    (this.body as unknown as { aabbNeedsUpdate: boolean }).aabbNeedsUpdate = true;

    const scale = this.radius / INITIAL_RADIUS;
    this.platformMesh.children[0].scale.set(scale, 1, scale);
    this.edgeRing.scale.set(scale, scale, 1);
  }

  reset() {
    this.radius = INITIAL_RADIUS;
    this.timeSinceShrink = 0;
    this.elapsed = 0;
    this.body.shapes = [];
    this.body.addShape(new CANNON.Cylinder(this.radius, this.radius, PLATFORM_THICKNESS, 32));
    (this.body as unknown as { aabbNeedsUpdate: boolean }).aabbNeedsUpdate = true;
    this.platformMesh.children[0].scale.set(1, 1, 1);
    this.edgeRing.scale.set(1, 1, 1);
    this.spawnHazards();
  }
}
