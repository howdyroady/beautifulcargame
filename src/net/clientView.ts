import * as THREE from 'three';
import { createCarModel, type CarModel } from '../car/carModel';
import type { StateMessage, HazardSnapshot, PowerupSnapshot } from './protocol';

const SMOOTHING = 14; // higher = snappier tracking of the host's authoritative state

export class ClientView {
  private scene: THREE.Scene;
  private cars: [CarModel, CarModel];
  private platform: THREE.Mesh;
  private edgeRing: THREE.Mesh;
  private hazardMeshes: THREE.Mesh[] = [];
  private hazardKey = '';
  private powerupMeshes = new Map<number, THREE.Group>();
  private initialRadius: number;

  constructor(scene: THREE.Scene, initialRadius: number) {
    this.scene = scene;
    this.initialRadius = initialRadius;

    const carA = createCarModel(0x9aa0a8);
    const carB = createCarModel(0xb03030);
    scene.add(carA.group, carB.group);
    this.cars = [carA, carB];

    const topMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.85, metalness: 0.1 });
    const sideMat = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.9, metalness: 0.1 });
    this.platform = new THREE.Mesh(new THREE.CylinderGeometry(initialRadius, initialRadius, 1, 48), [sideMat, topMat, topMat]);
    this.platform.position.y = -0.5;
    this.platform.receiveShadow = true;
    scene.add(this.platform);

    this.edgeRing = new THREE.Mesh(
      new THREE.TorusGeometry(initialRadius, 0.15, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff2020, emissiveIntensity: 0.8, roughness: 0.4 }),
    );
    this.edgeRing.rotation.x = Math.PI / 2;
    this.edgeRing.position.y = 0.05;
    scene.add(this.edgeRing);
  }

  private syncHazards(hazards: HazardSnapshot[]) {
    const key = hazards.map((h) => `${h.type}:${h.x.toFixed(1)}:${h.z.toFixed(1)}`).join('|');
    if (key === this.hazardKey) return;
    this.hazardKey = key;
    for (const m of this.hazardMeshes) this.scene.remove(m);
    this.hazardMeshes = hazards.map((h) => {
      const color = h.type === 'ice' ? 0x8fd8ff : 0xffb020;
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(h.radius, 24),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.55 }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(h.x, 0.03, h.z);
      this.scene.add(mesh);
      return mesh;
    });
  }

  private syncPowerups(powerups: PowerupSnapshot[]) {
    const seen = new Set(powerups.map((p) => p.id));
    for (const [id, mesh] of this.powerupMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.powerupMeshes.delete(id);
      }
    }
    const colors: Record<string, number> = { nitro: 0x40ff70, shield: 0x40c0ff, emp: 0xd040ff, ram: 0xff5030 };
    for (const p of powerups) {
      if (!this.powerupMeshes.has(p.id)) {
        const g = new THREE.Group();
        const color = colors[p.type];
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 }));
        base.position.y = 0.06;
        g.add(base);
        const icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.2, roughness: 0.2 }));
        icon.position.y = 0.9;
        g.add(icon);
        g.position.set(p.x, 0, p.z);
        this.scene.add(g);
        this.powerupMeshes.set(p.id, g);
      }
    }
  }

  applyState(state: StateMessage, dt: number) {
    const scale = state.arenaRadius / this.initialRadius;
    this.platform.scale.set(scale, 1, scale);
    this.edgeRing.scale.set(scale, scale, 1);

    this.syncHazards(state.hazards);
    this.syncPowerups(state.powerups);

    const alpha = 1 - Math.exp(-SMOOTHING * dt);
    state.cars.forEach((snap, i) => {
      const group = this.cars[i].group;
      group.position.lerp(new THREE.Vector3(snap.x, snap.y, snap.z), alpha);
      const targetQuat = new THREE.Quaternion(snap.qx, snap.qy, snap.qz, snap.qw);
      group.quaternion.slerp(targetQuat, alpha);
    });

    for (const g of this.powerupMeshes.values()) {
      g.children[1].rotation.y += dt * 2;
    }
  }

  carPositions(): { x: number; z: number }[] {
    return this.cars.map((c) => ({ x: c.group.position.x, z: c.group.position.z }));
  }
}
