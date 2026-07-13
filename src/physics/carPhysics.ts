import * as CANNON from 'cannon-es';
import type { CarDimensions } from '../car/carModel';
import type { CarInput } from '../input/input';

export interface CarPhysicsConfig {
  enginePower: number;
  turnRate: number;
  maxSpeed: number;
  linearDamping: number;
  angularDamping: number;
  /** Lateral grip reduction when handbraking — lower = slidier. */
  driftGrip: number;
}

export const DEFAULT_CAR_CONFIG: CarPhysicsConfig = {
  enginePower: 3200,
  turnRate: 2.8,
  maxSpeed: 18,
  linearDamping: 0.26,
  angularDamping: 0.88,
  driftGrip: 0.55,
};

export function createCarBody(dims: CarDimensions, material: CANNON.Material, position: CANNON.Vec3): CANNON.Body {
  const halfExtents = new CANNON.Vec3(dims.length / 2, dims.height / 2, dims.width / 2);
  const shape = new CANNON.Box(halfExtents);
  const body = new CANNON.Body({
    mass: 200,
    shape,
    material,
    position,
    linearDamping: DEFAULT_CAR_CONFIG.linearDamping,
    angularDamping: DEFAULT_CAR_CONFIG.angularDamping,
  });
  body.angularFactor.set(0, 1, 0);
  body.fixedRotation = false;
  body.updateMassProperties();
  return body;
}

/**
 * Computes the drift/slip angle: the angle between where the car is pointing and
 * where it's actually moving. Returned in radians; > ~0.25 rad ≈ noticeable drift.
 */
export function computeSlipAngle(body: CANNON.Body): number {
  const forward = new CANNON.Vec3(1, 0, 0);
  body.quaternion.vmult(forward, forward);
  const vel = new CANNON.Vec3(body.velocity.x, 0, body.velocity.z);
  const speed = vel.length();
  if (speed < 1.5) return 0;
  vel.normalize();
  forward.y = 0;
  const fLen = Math.hypot(forward.x, forward.z);
  if (fLen < 0.001) return 0;
  forward.x /= fLen;
  forward.z /= fLen;
  const dot = forward.x * vel.x + forward.z * vel.z;
  const cross = forward.x * vel.z - forward.z * vel.x;
  return Math.abs(Math.atan2(cross, dot));
}

/** Arcade control: forward thrust, yaw torque, speed cap, lateral grip, optional handbrake drift. */
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

  const right = new CANNON.Vec3(-forward.z, 0, forward.x);
  const velForward = body.velocity.x * forward.x + body.velocity.z * forward.z;
  const velLateral = body.velocity.x * right.x + body.velocity.z * right.z;
  const speedRatio = Math.min(Math.abs(velForward) / config.maxSpeed, 1);

  // --- Throttle ---
  if (input.throttle !== 0) {
    const power = config.enginePower * speedMultiplier * (1 - speedRatio * 0.55);
    const force = new CANNON.Vec3(forward.x * input.throttle * power, 0, forward.z * input.throttle * power);
    body.applyForce(force, new CANNON.Vec3());
  }

  // --- Brake ---
  if (input.brake) {
    body.velocity.x *= 0.88;
    body.velocity.z *= 0.88;
  }

  // --- Lateral grip (reduces side-slip; lower during drifts) ---
  // Threshold 0.3 rad: everyday cornering keeps full grip; only a deliberate
  // hard flick breaks into a drift. Lower values made casual turns slide out.
  const slipAngle = computeSlipAngle(body);
  const isDrifting = slipAngle > 0.3;
  const lateralGrip = isDrifting ? config.driftGrip : 0.85;
  body.velocity.x -= right.x * velLateral * lateralGrip * dt * 12;
  body.velocity.z -= right.z * velLateral * lateralGrip * dt * 12;

  // --- Steering (target yaw-rate model) ---
  // Target-yaw model: the car's yaw rate eases toward a target set by the input;
  // releasing the stick snaps the target to 0 so the car straightens itself.
  //
  // SIGN: rotating about +Y maps +X toward −Z, i.e. positive angular velocity
  // turns the car LEFT in our atan2(z, x) heading convention. Steer input is
  // +1 = right (keyboard 'D', right arrow button, and the AI's `desired − current`
  // angle error all assume positive steer increases the heading angle), so the
  // target yaw rate must be NEGATED. Without this the controls are mirrored.
  const speedFactor = Math.min(1, Math.abs(velForward) / 2.5); // can't pivot when nearly stopped
  // Ease off with speed — full lock at top speed is how spins start.
  const steerAuthority = 1 - speedRatio * 0.45;
  // Reverse flips steering like a real car; the small dead-band keeps a wall
  // bounce (brief negative velForward) from flipping the direction mid-corner.
  const direction = velForward < -0.4 ? -1 : 1;
  const driftBonus = isDrifting ? 1.1 : 1.0;
  const targetYaw =
    -input.steer * config.turnRate * handlingMultiplier * steerAuthority * driftBonus * direction * speedFactor;
  // Ease in quickly when steering, straighten a touch more gently when centered.
  const yawResponse = input.steer !== 0 ? 9 : 6;
  body.angularVelocity.y += (targetYaw - body.angularVelocity.y) * Math.min(1, dt * yawResponse);

  const maxAngular = 2.7 * handlingMultiplier;
  if (body.angularVelocity.y > maxAngular) body.angularVelocity.y = maxAngular;
  if (body.angularVelocity.y < -maxAngular) body.angularVelocity.y = -maxAngular;

  // --- Speed cap ---
  const horizSpeed = Math.hypot(body.velocity.x, body.velocity.z);
  const cap = config.maxSpeed * speedMultiplier;
  if (horizSpeed > cap) {
    const scale = cap / horizSpeed;
    body.velocity.x *= scale;
    body.velocity.z *= scale;
  }
}
