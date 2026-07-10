import * as THREE from 'three';
import { createCarModel, type CarModel } from '../car/carModel';
import { Circuit, TRACKS } from '../track/circuit';
import type { CarSnapshot } from './protocol';

const SMOOTHING = 14;

/** Client-side view for online races: builds the circuit visuals locally (deterministic from trackId) and interpolates the two cars from host snapshots. */
export class ArcadeClientView {
  private cars: [CarModel, CarModel];
  circuit: Circuit;

  constructor(scene: THREE.Scene, trackId: string, hostColor: number, ownColor: number) {
    this.circuit = new Circuit(scene, null, null, TRACKS[trackId] ?? TRACKS.city);
    const carA = createCarModel(hostColor);
    const carB = createCarModel(ownColor);
    scene.add(carA.group, carB.group);
    this.cars = [carA, carB];
  }

  applyState(cars: [CarSnapshot, CarSnapshot], dt: number) {
    const alpha = 1 - Math.exp(-SMOOTHING * dt);
    cars.forEach((snap, i) => {
      const group = this.cars[i].group;
      group.position.lerp(new THREE.Vector3(snap.x, snap.y, snap.z), alpha);
      group.quaternion.slerp(new THREE.Quaternion(snap.qx, snap.qy, snap.qz, snap.qw), alpha);
    });
  }

  /** Heading of a car for the chase camera, derived from the interpolated visual transform. */
  headingOf(i: 0 | 1): { x: number; z: number } {
    const f = new THREE.Vector3(1, 0, 0).applyQuaternion(this.cars[i].group.quaternion);
    const len = Math.hypot(f.x, f.z) || 1;
    return { x: f.x / len, z: f.z / len };
  }

  positionOf(i: 0 | 1): { x: number; z: number } {
    return { x: this.cars[i].group.position.x, z: this.cars[i].group.position.z };
  }
}
