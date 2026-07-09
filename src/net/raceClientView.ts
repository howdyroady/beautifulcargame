import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarModel, type CarModel } from '../car/carModel';
import { Track } from '../arena/track';
import type { CarSnapshot } from './protocol';

const SMOOTHING = 14;

/** Renders the race purely from host snapshots — the track geometry is static/deterministic so the client can build its own copy locally instead of streaming it. */
export class RaceClientView {
  private cars: [CarModel, CarModel];

  constructor(scene: THREE.Scene) {
    // The client needs no physics simulation of its own, but Track's constructor wants a world/materials
    // to register static colliders in — harmless busywork here since nothing steps this world.
    const dummyWorld = new CANNON.World();
    const dummyMat = new CANNON.Material('unused');
    new Track(scene, dummyWorld, dummyMat, dummyMat);

    const carA = createCarModel(0x9199a1);
    const carB = createCarModel(0xb03030);
    scene.add(carA.group, carB.group);
    this.cars = [carA, carB];
  }

  applyState(cars: [CarSnapshot, CarSnapshot], dt: number) {
    const alpha = 1 - Math.exp(-SMOOTHING * dt);
    cars.forEach((snap, i) => {
      const group = this.cars[i].group;
      group.position.lerp(new THREE.Vector3(snap.x, snap.y, snap.z), alpha);
      const targetQuat = new THREE.Quaternion(snap.qx, snap.qy, snap.qz, snap.qw);
      group.quaternion.slerp(targetQuat, alpha);
    });
  }

  carPositions(): { x: number; z: number }[] {
    return this.cars.map((c) => ({ x: c.group.position.x, z: c.group.position.z }));
  }
}
