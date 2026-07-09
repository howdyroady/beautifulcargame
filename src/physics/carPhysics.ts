import * as CANNON from 'cannon-es';
import type { CarDimensions } from '../car/carModel';
import type { CarInput } from '../input/input';

export interface CarPhysicsConfig {
  enginePower: number;
  turnRate: number;
  maxSpeed: number;
  linearDamping: number;
  angularDamping: number;
}

export const DEFAULT_CAR_CONFIG: CarPhysicsConfig = {
  // Needs to comfortably clear static friction (~0.35 * mass(220) * gravity(18) ≈ 1386N) to actually move the car.
  enginePower: 2800,
  turnRate: 2.6,
  maxSpeed: 16,
  linearDamping: 0.28,
  angularDamping: 0.9,
};

export function createCarBody(dims: CarDimensions, material: CANNON.Material, position: CANNON.Vec3): CANNON.Body {
  const halfExtents = new CANNON.Vec3(dims.length / 2, dims.height / 2, dims.width / 2);
  const shape = new CANNON.Box(halfExtents);
  const body = new CANNON.Body({
    mass: 220,
    shape,
    material,
    position,
    linearDamping: DEFAULT_CAR_CONFIG.linearDamping,
    angularDamping: DEFAULT_CAR_CONFIG.angularDamping,
  });
  body.angularFactor.set(0, 1, 0); // only allow yaw rotation, keep the car from tipping/tumbling
  body.fixedRotation = false;
  body.updateMassProperties();
  return body;
}

/** Arcade-style control: forward/back thrust along facing direction, yaw torque for steering, speed-scaled traction. */
export function applyCarControl(
  body: CANNON.Body,
  input: CarInput,
  dt: number,
  config: CarPhysicsConfig = DEFAULT_CAR_CONFIG,
  speedMultiplier = 1,
  handlingMultiplier = 1,
) {
  const forward = new CANNON.Vec3(1, 0, 0);
  body.quaternion.vmult(forward, forward);
  forward.y = 0;
  const len = Math.hypot(forward.x, forward.z) || 1;
  forward.x /= len;
  forward.z /= len;

  const velForward = body.velocity.x * forward.x + body.velocity.z * forward.z;
  const speedRatio = Math.min(Math.abs(velForward) / config.maxSpeed, 1);

  if (input.throttle !== 0) {
    const power = config.enginePower * speedMultiplier * (1 - speedRatio * 0.6);
    const force = new CANNON.Vec3(forward.x * input.throttle * power, 0, forward.z * input.throttle * power);
    body.applyForce(force, new CANNON.Vec3());
  }

  if (input.brake) {
    body.velocity.x *= 0.9;
    body.velocity.z *= 0.9;
  }

  if (input.steer !== 0) {
    // Steering authority scales with speed so stationary cars don't spin in place like a top.
    const steerFactor = 0.25 + speedRatio * 0.75;
    const direction = velForward < 0 ? -1 : 1;
    body.angularVelocity.y += input.steer * config.turnRate * handlingMultiplier * steerFactor * direction * dt * 12;
  }

  const maxAngular = 3.2 * handlingMultiplier;
  if (body.angularVelocity.y > maxAngular) body.angularVelocity.y = maxAngular;
  if (body.angularVelocity.y < -maxAngular) body.angularVelocity.y = -maxAngular;

  const horizSpeed = Math.hypot(body.velocity.x, body.velocity.z);
  const cap = config.maxSpeed * speedMultiplier;
  if (horizSpeed > cap) {
    const scale = cap / horizSpeed;
    body.velocity.x *= scale;
    body.velocity.z *= scale;
  }
}
