/**
 * Physics smoke test — run with `npm run test:physics`.
 *
 * Drives the RaycastVehicle-based car (see src/physics/raycastCar.ts) headless
 * and asserts the invariants that have regressed before:
 *
 *  1. The car actually accelerates to (near) max speed under full throttle —
 *     guards against the historical "friction lock" class of bugs where the
 *     car was pinned at walking pace.
 *  2. Behaviour is frame-rate independent: 60/30/20 fps runs must cover the
 *     same distance within tolerance (mobile devices run at low fps).
 *  3. steer = +1 turns the car RIGHT (increases the atan2(z,x) heading) —
 *     keyboard, touch arrows, and both AI controllers all assume this;
 *     a flipped sign mirrors every control in the game (shipped once!).
 *  4. The suspension settles: the chassis must come to rest at a stable
 *     height, not sink through the floor or bounce off to space.
 */
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../src/physics/world.ts';
import { RaycastCar } from '../src/physics/raycastCar.ts';

const dims = { length: 4.59, width: 1.78, height: 1.4, wheelRadius: 0.35 };

function makeWorld() {
  const pw = createPhysicsWorld();
  const ground = new CANNON.Body({ mass: 0, material: pw.groundMaterial, shape: new CANNON.Plane() });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  pw.world.addBody(ground);
  return pw;
}

function drive(pw, car, input, seconds, dt) {
  let t = 0;
  while (t < seconds) {
    car.applyControl(input, dt, 1, 1);
    pw.step(dt);
    t += dt;
  }
}

let failed = false;

// --- 1+2: full-throttle acceleration at several frame rates ---
const results = [];
for (const dt of [1 / 60, 1 / 30, 1 / 20]) {
  const pw = makeWorld();
  const car = new RaycastCar(pw.world, dims, pw.carMaterial, new CANNON.Vec3(0, 1.0, 0));
  drive(pw, car, { throttle: 0, steer: 0, brake: false, nitro: false }, 1, dt); // settle
  const x0 = car.body.position.x;
  drive(pw, car, { throttle: 1, steer: 0, brake: false, nitro: false }, 5, dt);
  const speed = Math.hypot(car.body.velocity.x, car.body.velocity.z);
  const distance = car.body.position.x - x0;
  results.push({ dt, speed, distance });
  console.log(`dt=${dt.toFixed(4)} → speed=${speed.toFixed(2)} m/s, distance=${distance.toFixed(1)} m`);
  if (speed < car.config.maxSpeed * 0.75) {
    console.error(`FAIL: only ${speed.toFixed(2)} m/s at dt=${dt.toFixed(4)} (friction lock / engine too weak?)`);
    failed = true;
  }
}
const dists = results.map((r) => r.distance);
const spread = (Math.max(...dists) - Math.min(...dists)) / Math.max(...dists);
if (spread > 0.15) {
  console.error(`FAIL: distance varies ${(spread * 100).toFixed(0)}% across frame rates`);
  failed = true;
}

// --- 3: steering sign ---
{
  const pw = makeWorld();
  const car = new RaycastCar(pw.world, dims, pw.carMaterial, new CANNON.Vec3(0, 1.0, 0));
  drive(pw, car, { throttle: 0, steer: 0, brake: false, nitro: false }, 1, 1 / 60);
  drive(pw, car, { throttle: 1, steer: 1, brake: false, nitro: false }, 1.4, 1 / 60);
  const fwd = new CANNON.Vec3(1, 0, 0);
  car.body.quaternion.vmult(fwd, fwd);
  const heading = Math.atan2(fwd.z, fwd.x);
  console.log(`steer=+1 for 1.4s → heading=${heading.toFixed(2)} rad`);
  if (heading < 0.08 || heading > Math.PI - 0.2) {
    console.error('FAIL: steer +1 did not turn the car right (heading should be clearly positive).');
    failed = true;
  }
}

// --- 4: suspension settles at a sane height ---
{
  const pw = makeWorld();
  const car = new RaycastCar(pw.world, dims, pw.carMaterial, new CANNON.Vec3(0, 1.2, 0));
  drive(pw, car, { throttle: 0, steer: 0, brake: false, nitro: false }, 3, 1 / 60);
  const y = car.body.position.y;
  const vy = Math.abs(car.body.velocity.y);
  console.log(`rest height=${y.toFixed(3)}, |vy|=${vy.toFixed(3)}`);
  if (y < 0.3 || y > 1.2 || vy > 0.25) {
    console.error('FAIL: chassis did not settle (sunk, floated, or keeps bouncing).');
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('OK: accelerates, frame-rate independent, steering sign correct, suspension settles.');
