import * as CANNON from 'cannon-es';
import type { CarDimensions } from '../car/carModel';
import type { CarInput } from '../input/input';

/**
 * Raycast-vehicle car physics.
 *
 * Replaces the old "yaw-locked box + hand-rolled forces" controller with
 * cannon-es's RaycastVehicle: four suspension raycasts carry the chassis,
 * the front wheels steer, and engine/brake forces act at the wheels. This is
 * the same approach (and starting tuning) as the MIT-licensed
 * pmndrs/racing-game — see THIRD_PARTY_NOTICES.md — adapted to this game's
 * scale (car ≈ 4.6 m, gravity −18, arcade top speed).
 *
 * What it buys us over the old controller:
 *  - the body pitches under braking, squats on launch, and rolls into corners
 *  - steering feel comes from wheel geometry + tire friction, not a yaw hack
 *  - jumps/curbs behave naturally because each wheel tracks the ground
 */

export interface RaycastCarConfig {
  /** Peak engine force distributed across the driven wheels (N). */
  engineForce: number;
  /** Wheel brake torque when braking. */
  maxBrake: number;
  /** Max steering lock at standstill (rad). */
  maxSteer: number;
  /** Soft top speed (m/s); nitro etc. scale it via speedMultiplier. */
  maxSpeed: number;
  /** Tire grip. Higher = more planted, lower = slidier. */
  frictionSlip: number;
}

// engineForce must stay under the per-wheel grip budget (frictionSlip × wheel
// load ≈ 3.2 × 990 N) split across 4 wheels, otherwise the tires slide and
// cannon halves the effective push — the car plateaus far below max speed.
export const DEFAULT_RC_CONFIG: RaycastCarConfig = {
  engineForce: 3800,
  maxBrake: 55,
  maxSteer: 0.55,
  maxSpeed: 18,
  frictionSlip: 3.2,
};

const WHEEL_ORDER: [number, number][] = [
  // Matches carModel's wheel build order: [xSign, zSign]
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Chassis rest height above ground for a settled suspension — used to spawn
 * cars already "sitting" instead of dropping them onto the springs. */
export function chassisRestHeight(dims: CarDimensions): number {
  // wheel radius + sagged suspension + connection-point offset below centre
  return dims.wheelRadius + 0.32 - 18 / (4 * 42) + dims.height * 0.08;
}

export class RaycastCar {
  body: CANNON.Body;
  vehicle: CANNON.RaycastVehicle;
  config: RaycastCarConfig;
  /** Smoothed current steering angle (rad) — also drives the wheel visuals. */
  currentSteer = 0;

  private world: CANNON.World;

  constructor(
    world: CANNON.World,
    dims: CarDimensions,
    material: CANNON.Material,
    position: CANNON.Vec3,
    config: RaycastCarConfig = DEFAULT_RC_CONFIG,
  ) {
    this.world = world;
    this.config = config;

    // Flat chassis box: full footprint but only ~40% of the visual height, so
    // the centre of mass stays low and the car resists flipping.
    const half = new CANNON.Vec3(dims.length / 2, dims.height * 0.2, dims.width / 2);
    // Spawn with the suspension already settled: dropping the car onto its
    // springs slams them into the travel clamp and can pitch the chassis onto
    // its nose, where it wedges with the wheels in the air.
    const spawn = new CANNON.Vec3(position.x, chassisRestHeight(dims), position.z);
    this.body = new CANNON.Body({
      mass: 220,
      material,
      position: spawn,
      shape: new CANNON.Box(half),
      angularDamping: 0.55,
      linearDamping: 0.02,
    });
    this.body.allowSleep = false;

    this.vehicle = new CANNON.RaycastVehicle({
      chassisBody: this.body,
      indexRightAxis: 2, // +Z
      indexForwardAxis: 0, // +X
      indexUpAxis: 1, // +Y
    });

    const wheelX = dims.length * 0.33;
    const wheelZ = dims.width / 2 - 0.06;
    for (const [xs, zs] of WHEEL_ORDER) {
      this.vehicle.addWheel({
        radius: dims.wheelRadius,
        directionLocal: new CANNON.Vec3(0, -1, 0),
        axleLocal: new CANNON.Vec3(0, 0, 1),
        chassisConnectionPointLocal: new CANNON.Vec3(xs * wheelX, -dims.height * 0.08, zs * wheelZ),
        suspensionStiffness: 42,
        suspensionRestLength: 0.32,
        maxSuspensionTravel: 0.3,
        dampingRelaxation: 2.6,
        dampingCompression: 4.6,
        frictionSlip: config.frictionSlip,
        rollInfluence: 0.01,
        maxSuspensionForce: 1e5,
        customSlidingRotationalSpeed: -30,
        useCustomSlidingRotationalSpeed: true,
      });
    }
    this.vehicle.addToWorld(world);
  }

  /** Ground-truth forward unit vector on the XZ plane. */
  forward(): { x: number; z: number } {
    const f = new CANNON.Vec3(1, 0, 0);
    this.body.quaternion.vmult(f, f);
    const len = Math.hypot(f.x, f.z) || 1;
    return { x: f.x / len, z: f.z / len };
  }

  /**
   * Drive the vehicle from a CarInput. speedMultiplier scales engine force and
   * the top-speed cap (nitro/comeback/ice), handlingMultiplier scales steering.
   */
  applyControl(input: CarInput, dt: number, speedMultiplier = 1, handlingMultiplier = 1) {
    const f = this.forward();
    const velForward = this.body.velocity.x * f.x + this.body.velocity.z * f.z;
    const speed = Math.hypot(this.body.velocity.x, this.body.velocity.z);

    // --- Steering: full lock while parking, tightening at speed for stability.
    const authority = 1 / (1 + Math.pow(Math.abs(velForward) / 13, 1.7));
    // Positive steer input = turn right = decrease of the +Y yaw = negative
    // steering angle in cannon's convention with axleLocal +Z (verified by the
    // steering-sign assertion in tests/physics.smoke.mjs).
    const targetSteer = -input.steer * this.config.maxSteer * (0.3 + 0.7 * authority) * handlingMultiplier;
    this.currentSteer += (targetSteer - this.currentSteer) * Math.min(1, dt * 11);
    this.vehicle.setSteeringValue(this.currentSteer, 0);
    this.vehicle.setSteeringValue(this.currentSteer, 1);

    // --- Engine: AWD with a slight rear bias, fading near the speed cap.
    const cap = this.config.maxSpeed * speedMultiplier;
    let engine = 0;
    if (input.throttle > 0 && velForward < cap) {
      engine = input.throttle * this.config.engineForce * speedMultiplier * (1 - Math.max(0, velForward / cap) * 0.3);
    } else if (input.throttle < 0 && velForward > -cap * 0.45) {
      engine = input.throttle * this.config.engineForce * 0.65;
    }
    for (let i = 0; i < 4; i++) this.vehicle.applyEngineForce(engine * 0.25, i);

    // --- Brake: hard on the brake button, light drag when coasting so the car
    // settles instead of rolling forever (matters for precise parking).
    const brake = input.brake ? this.config.maxBrake : input.throttle === 0 ? 2.2 : 0;
    for (let i = 0; i < 4; i++) this.vehicle.setBrake(brake, i);

    // --- Hard cap (nitro overshoot, downhill, boost pads).
    const hardCap = cap * 1.04;
    if (speed > hardCap) {
      const s = hardCap / speed;
      this.body.velocity.x *= s;
      this.body.velocity.z *= s;
    }

    // --- Arcade stabilizer: keep the rubber side down. Suspension impulses at
    // the contact points can pitch the chassis onto its nose/tail, where the
    // box then rests on the ground with the wheels in the air — a stable but
    // useless state. Damp pitch/roll rates and spring the up-vector back to
    // vertical whenever tilt exceeds what normal body-roll needs.
    const up = new CANNON.Vec3(0, 1, 0);
    this.body.quaternion.vmult(up, up);
    const tilt = Math.acos(Math.min(1, Math.max(-1, up.y)));
    const damp = Math.max(0, 1 - dt * 5);
    this.body.angularVelocity.x *= damp;
    this.body.angularVelocity.z *= damp;
    if (tilt > 0.12) {
      // Restoring torque about the axis that rights the car (up × worldUp).
      const axis = new CANNON.Vec3(up.z, 0, -up.x); // up × (0,1,0)
      const len = axis.length();
      if (len > 1e-4) {
        axis.scale(1 / len, axis);
        const strength = Math.min(1, (tilt - 0.12) * 3) * 26 * dt;
        this.body.angularVelocity.x += axis.x * strength;
        this.body.angularVelocity.z += axis.z * strength;
      }
    }
  }

  /** World-space pose of wheel i (position + suspension), for visuals. */
  wheelPose(i: number): { x: number; y: number; z: number } {
    this.vehicle.updateWheelTransform(i);
    const t = this.vehicle.wheelInfos[i].worldTransform;
    return { x: t.position.x, y: t.position.y, z: t.position.z };
  }

  removeFromWorld() {
    this.vehicle.removeFromWorld(this.world);
  }
}
