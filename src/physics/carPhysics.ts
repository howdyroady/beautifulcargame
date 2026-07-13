import * as CANNON from 'cannon-es';

/**
 * Computes the drift/slip angle: the angle between where the car is pointing and
 * where it's actually moving. Returned in radians; > ~0.25 rad ≈ noticeable drift.
 *
 * (The old hand-rolled force/steering controller that lived here has been
 * replaced by the RaycastVehicle in raycastCar.ts.)
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
