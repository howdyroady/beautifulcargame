import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarModel } from '../car/carModel';
import type { Circuit } from '../track/circuit';

/**
 * City-car-racing style traffic: slow cars cruising along the track that the
 * player has to weave through (the "blockade durch andere Autos"). They are
 * deliberately *not* full RaycastVehicles — that would cost four extra raycasts
 * each and drag mobile fps. Instead each is a static collider (mass 0) that we
 * teleport along the spline every frame; the physics world's step() already
 * refreshes static-body AABBs, so the player still collides and gets nudged
 * (car↔car contact material gives the bounce). They keep to fixed lanes so the
 * racing-line AI mostly flows around them.
 */
interface TrafficCar {
  group: THREE.Group;
  body: CANNON.Body;
  t: number;
  speed: number; // fraction of curve per second
  lane: number; // lateral offset in metres
  bodyY: number; // chassis centre height
}

const TRAFFIC_COLORS = [0x30354a, 0x6a6e78, 0x7a3030, 0x2a5a3a, 0x84683c, 0x404450];

export class Traffic {
  private cars: TrafficCar[] = [];
  private circuit: Circuit;
  private curveLength: number;

  constructor(scene: THREE.Scene, world: CANNON.World, circuit: Circuit, carMaterial: CANNON.Material, count: number) {
    this.circuit = circuit;
    this.curveLength = circuit.curve.getLength();
    const halfRoad = circuit.config.width / 2 - 1.2;

    for (let i = 0; i < count; i++) {
      const model = createCarModel(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]);
      // Night traffic drives with its lights on — the glowing taillights ahead
      // are what make the road read as "alive" (and warn the player early).
      model.setBrakeLights?.(true);
      scene.add(model.group);

      // ~30–45 km/h in the sim's units — clearly slower than the racers.
      const speed = (2.6 + Math.random() * 1.4) / this.curveLength;
      // Alternate lanes so consecutive cars don't line up single-file.
      const lane = (i % 3 === 0 ? -1 : i % 3 === 1 ? 1 : 0) * halfRoad * 0.7;

      const dims = model.dims;
      const body = new CANNON.Body({
        mass: 0,
        material: carMaterial,
        shape: new CANNON.Box(new CANNON.Vec3(dims.length / 2, dims.height / 2, dims.width / 2)),
      });
      world.addBody(body);

      this.cars.push({ group: model.group, body, t: (i / count + 0.13) % 1, speed, lane, bodyY: dims.height / 2 });
    }
    this.sync(0);
  }

  update(dt: number) {
    for (const c of this.cars) c.t = (c.t + c.speed * dt) % 1;
    this.sync(dt);
  }

  private sync(_dt: number) {
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of this.cars) {
      const p = this.circuit.curve.getPointAt(c.t);
      const tan = this.circuit.curve.getTangentAt(c.t).setY(0).normalize();
      const left = new THREE.Vector3(-tan.z, 0, tan.x);
      const pos = p.clone().addScaledVector(left, c.lane);
      const heading = Math.atan2(-tan.z, tan.x);

      c.group.position.set(pos.x, 0, pos.z);
      c.group.quaternion.setFromAxisAngle(up, heading);
      c.body.position.set(pos.x, c.bodyY, pos.z);
      c.body.quaternion.setFromEuler(0, heading, 0);
    }
  }

  dispose(scene: THREE.Scene, world: CANNON.World) {
    for (const c of this.cars) {
      scene.remove(c.group);
      world.removeBody(c.body);
    }
    this.cars = [];
  }
}
