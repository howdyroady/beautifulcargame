import * as THREE from 'three';
import type { PowerupType } from './carEntity';

interface Pad {
  id: number;
  type: PowerupType;
  x: number;
  z: number;
  mesh: THREE.Group;
  active: boolean;
  respawnAt: number;
}

const TYPES: PowerupType[] = ['nitro', 'shield', 'emp', 'ram'];
const COLORS: Record<PowerupType, number> = {
  nitro: 0x40ff70,
  shield: 0x40c0ff,
  emp: 0xd040ff,
  ram: 0xff5030,
};
const SPAWN_INTERVAL = 13;
const PICKUP_RADIUS = 1.6;

export class PowerupManager {
  private scene: THREE.Scene;
  private arenaRadius: () => number;
  private pads: Pad[] = [];
  private timeSinceSpawn = SPAWN_INTERVAL - 3;
  private nextId = 1;

  constructor(scene: THREE.Scene, arenaRadius: () => number) {
    this.scene = scene;
    this.arenaRadius = arenaRadius;
  }

  private buildPadMesh(type: PowerupType): THREE.Group {
    const g = new THREE.Group();
    const color = COLORS[type];
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 0.12, 20),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.4 }),
    );
    base.position.y = 0.06;
    g.add(base);
    const icon = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.45, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 1.2, roughness: 0.2 }),
    );
    icon.position.y = 0.9;
    g.add(icon);
    return g;
  }

  private spawnOne() {
    const type = TYPES[Math.floor(Math.random() * TYPES.length)];
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * (this.arenaRadius() * 0.55);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    const mesh = this.buildPadMesh(type);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.pads.push({ id: this.nextId++, type, x, z, mesh, active: true, respawnAt: 0 });
  }

  reset() {
    for (const p of this.pads) this.scene.remove(p.mesh);
    this.pads = [];
    this.timeSinceSpawn = SPAWN_INTERVAL - 3;
  }

  getSnapshot(): { id: number; type: PowerupType; x: number; z: number }[] {
    return this.pads.filter((p) => p.active).map((p) => ({ id: p.id, type: p.type, x: p.x, z: p.z }));
  }

  update(dt: number, matchTime: number, carPositions: { x: number; z: number }[], onPickup: (carIndex: number, type: PowerupType) => void) {
    for (const pad of this.pads) {
      if (pad.active) {
        pad.mesh.children[1].rotation.y += dt * 2;
        pad.mesh.position.y = Math.sin(matchTime * 2 + pad.x) * 0.1;
      }
    }

    this.timeSinceSpawn += dt;
    if (this.timeSinceSpawn >= SPAWN_INTERVAL && this.pads.filter((p) => p.active).length < 2) {
      this.timeSinceSpawn = 0;
      this.spawnOne();
    }

    for (const pad of this.pads) {
      if (!pad.active) continue;
      carPositions.forEach((pos, idx) => {
        const dx = pos.x - pad.x;
        const dz = pos.z - pad.z;
        if (dx * dx + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
          pad.active = false;
          pad.mesh.visible = false;
          onPickup(idx, pad.type);
          this.scene.remove(pad.mesh);
        }
      });
    }
    this.pads = this.pads.filter((p) => p.active);
  }
}
