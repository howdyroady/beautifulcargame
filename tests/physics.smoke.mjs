/**
 * Physics smoke test — run with `npm run test:physics`.
 *
 * Guards against two regressions that both presented as "the car doesn't move":
 *
 * 1. Contact-friction lock: cannon-es builds one friction equation per contact
 *    point, so a resting box (4 points) multiplies the friction coefficient —
 *    a seemingly modest µ produced more static friction than the engine force
 *    and froze the car solid at every frame rate. Car↔ground friction must stay
 *    ~0; grip is modeled in applyCarControl instead.
 *
 * 2. Frame-rate dependence: forces are applied once per render frame but cannon
 *    clears them after every fixed substep. Without re-applying them per substep,
 *    thrust collapsed on slow frames (mobile) while friction kept acting.
 *
 * The test drives a car body full-throttle for 5 simulated seconds at several
 * frame rates and asserts it reaches near max speed with consistent distance.
 */
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../src/physics/world.ts';
import { createCarBody, applyCarControl, DEFAULT_CAR_CONFIG } from '../src/physics/carPhysics.ts';

const pw = createPhysicsWorld();
const ground = new CANNON.Body({ mass: 0, material: pw.groundMaterial, shape: new CANNON.Plane() });
ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
pw.world.addBody(ground);

const dims = { length: 4.6, width: 2.0, height: 1.35 };
const body = createCarBody(dims, pw.carMaterial, new CANNON.Vec3(0, dims.height / 2 + 0.01, 0));
pw.world.addBody(body);

const input = { throttle: 1, steer: 0, brake: false, nitro: false };
const frameRates = [1 / 60, 1 / 30, 1 / 20];
const results = [];

for (const dt of frameRates) {
  body.position.set(0, dims.height / 2 + 0.01, 0);
  body.velocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
  body.quaternion.set(0, 0, 0, 1);
  let t = 0;
  while (t < 5) {
    applyCarControl(body, input, dt, DEFAULT_CAR_CONFIG, 1, 1);
    pw.step(dt);
    t += dt;
  }
  const speed = Math.hypot(body.velocity.x, body.velocity.z);
  results.push({ dt, speed, x: body.position.x });
  console.log(`dt=${dt.toFixed(4)} → speed=${speed.toFixed(2)} m/s, distance=${body.position.x.toFixed(1)} m`);
}

let failed = false;
for (const r of results) {
  if (r.speed < DEFAULT_CAR_CONFIG.maxSpeed * 0.85) {
    console.error(`FAIL: at dt=${r.dt.toFixed(4)} car only reached ${r.speed.toFixed(2)} m/s (friction lock?)`);
    failed = true;
  }
}
const distances = results.map((r) => r.x);
const spread = (Math.max(...distances) - Math.min(...distances)) / Math.max(...distances);
if (spread > 0.1) {
  console.error(`FAIL: distance varies ${(spread * 100).toFixed(0)}% across frame rates (physics not frame-rate independent)`);
  failed = true;
}

// --- Steering sign: steer +1 must turn RIGHT (increase the atan2(z,x) heading) ---
// The AI controllers compute steer from `desiredAngle − currentAngle` in that
// convention, and keyboard/touch map right to +1. A flipped sign mirrors every
// control in the game (this regression shipped once).
body.position.set(0, dims.height / 2 + 0.01, 0);
body.velocity.set(0, 0, 0);
body.angularVelocity.set(0, 0, 0);
body.quaternion.set(0, 0, 0, 1);
const steerInput = { throttle: 1, steer: 1, brake: false, nitro: false };
let t2 = 0;
while (t2 < 0.7) {
  // 0.7 s: long enough to build clear yaw, short enough not to wrap past ±π.
  applyCarControl(body, steerInput, 1 / 60, DEFAULT_CAR_CONFIG, 1, 1);
  pw.step(1 / 60);
  t2 += 1 / 60;
}
const fwd = new CANNON.Vec3(1, 0, 0);
body.quaternion.vmult(fwd, fwd);
const heading = Math.atan2(fwd.z, fwd.x);
console.log(`steer=+1 for 0.7s → heading=${heading.toFixed(2)} rad, yawVel=${body.angularVelocity.y.toFixed(2)}`);
if (heading < 0.1 || heading > Math.PI - 0.2) {
  console.error('FAIL: steer +1 did not turn the car right (heading should be clearly positive).');
  failed = true;
}

if (failed) process.exit(1);
console.log('OK: car accelerates to max speed, frame-rate independent, steering sign correct.');
