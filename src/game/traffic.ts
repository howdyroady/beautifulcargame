import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createCarModel } from '../car/carModel';
import type { Circuit } from '../track/circuit';

/**
 * City-car-racing style traffic: cars cruising along the track in proper lanes
 * that the player weaves through. They are deliberately *not* full
 * RaycastVehicles — that would cost four extra raycasts each and drag mobile
 * fps. Each is a static collider (mass 0) teleported along the spline every
 * frame; the physics step refreshes static AABBs, so the player collides and
 * gets nudged (car↔car contact material gives the bounce).
 *
 * Lane discipline like a real autobahn: each car keeps a fixed lane, and outer
 * (left) lanes flow faster than the right lanes, so gaps open and close and
 * squeezing through is a real skill.
 *
 * Ghost mode ("FREIE BAHN" pickup): traffic phases out for a few seconds —
 * colliders off, meshes faded — so the player can floor it to top speed.
 */
interface TrafficCar {
  group: THREE.Group;
  body: CANNON.Body;
  t: number;
  speed: number; // fraction of curve per second
  lane: number; // lateral offset in metres
  bodyY: number; // chassis centre height
  fadeMats: { mat: THREE.Material; baseOpacity: number }[];
}

const TRAFFIC_COLORS = [0x30354a, 0x6a6e78, 0x7a3030, 0x2a5a3a, 0x84683c, 0x404450];

export class Traffic {
  /** Seconds of ghost mode remaining (traffic phased out). */
  ghostRemaining = 0;

  private cars: TrafficCar[] = [];
  private circuit: Circuit;
  private curveLength: number;

  constructor(scene: THREE.Scene, world: CANNON.World, circuit: Circuit, carMaterial: CANNON.Material, count: number) {
    this.circuit = circuit;
    this.curveLength = circuit.curve.getLength();
    const halfRoad = circuit.config.width / 2 - 1.2;
    // 3 lanes: right, middle, left — spread across the road.
    const laneOffsets = [-halfRoad * 0.62, 0, halfRoad * 0.62];

    for (let i = 0; i < count; i++) {
      const model = createCarModel(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]);
      // Night traffic drives with its lights on — the glowing taillights ahead
      // are what make the road read as "alive" (and warn the player early).
      model.setBrakeLights?.(true);
      scene.add(model.group);

      const laneIdx = i % 3;
      // Autobahn discipline: the further left the lane, the faster the flow.
      // Right ~32 km/h, middle ~45, left ~58 (display km/h) with slight jitter.
      const laneSpeed = 2.4 + laneIdx * 1.1 + Math.random() * 0.5;
      const speed = laneSpeed / this.curveLength;
      const lane = laneOffsets[laneIdx];

      const dims = model.dims;
      const body = new CANNON.Body({
        mass: 0,
        material: carMaterial,
        shape: new CANNON.Box(new CANNON.Vec3(dims.length / 2, dims.height / 2, dims.width / 2)),
      });
      world.addBody(body);

      // Collect fadeable materials once for ghost mode.
      const fadeMats: TrafficCar['fadeMats'] = [];
      model.group.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            fadeMats.push({ mat: m, baseOpacity: (m as THREE.Material & { opacity: number }).opacity ?? 1 });
          }
        }
      });

      this.cars.push({
        group: model.group,
        body,
        t: (i / count + 0.13) % 1,
        speed,
        lane,
        bodyY: dims.height / 2,
        fadeMats,
      });
    }
    this.sync();
  }

  /** Phase traffic out for `seconds` — colliders off, meshes translucent. */
  setGhost(seconds: number) {
    const wasActive = this.ghostRemaining > 0;
    this.ghostRemaining = Math.max(this.ghostRemaining, seconds);
    if (!wasActive) this.applyGhost(true);
  }

  private applyGhost(on: boolean) {
    for (const c of this.cars) {
      c.body.collisionResponse = !on;
      for (const f of c.fadeMats) {
        f.mat.transparent = on || f.baseOpacity < 1;
        (f.mat as THREE.Material & { opacity: number }).opacity = on ? f.baseOpacity * 0.22 : f.baseOpacity;
      }
    }
  }

  update(dt: number) {
    if (this.ghostRemaining > 0) {
      this.ghostRemaining -= dt;
      if (this.ghostRemaining <= 0) {
        this.ghostRemaining = 0;
        this.applyGhost(false);
      }
    }
    for (const c of this.cars) c.t = (c.t + c.speed * dt) % 1;
    this.sync();
  }

  private sync() {
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
