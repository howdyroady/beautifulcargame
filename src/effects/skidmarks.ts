import * as THREE from 'three';

/**
 * Tire skid marks: a fixed pool of flat dark quads laid on the road while a car
 * drifts or brakes hard. One InstancedMesh = one draw call; slots are reused
 * round-robin, so old marks quietly vanish as new ones appear — no allocation,
 * no cleanup pass, bounded cost.
 */
export class SkidMarkPool {
  private mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly capacity: number;
  private dummy = new THREE.Object3D();
  /** Last drop position per emitter key, to space marks by distance. */
  private lastDrop = new Map<string, THREE.Vector3>();

  constructor(scene: THREE.Scene, capacity = 240) {
    this.capacity = capacity;
    const geo = new THREE.PlaneGeometry(0.24, 1.0);
    geo.rotateX(-Math.PI / 2); // lie flat on the road
    const mat = new THREE.MeshBasicMaterial({
      color: 0x08090c,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.renderOrder = 2; // above the road, below particles
    this.mesh.frustumCulled = false;
    // Park all instances out of sight initially.
    this.dummy.position.set(0, -40, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  /**
   * Drop a mark segment at (x,z) heading along `angle`, if the emitter has
   * moved far enough since its last mark. `key` identifies the emitting wheel.
   */
  drop(key: string, x: number, z: number, angle: number) {
    const last = this.lastDrop.get(key);
    if (last && (last.x - x) * (last.x - x) + (last.z - z) * (last.z - z) < 0.55 * 0.55) return;
    if (!last) this.lastDrop.set(key, new THREE.Vector3(x, 0, z));
    else last.set(x, 0, z);

    this.dummy.position.set(x, 0.035, z);
    this.dummy.rotation.set(0, angle, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(this.next, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.next = (this.next + 1) % this.capacity;
  }
}
