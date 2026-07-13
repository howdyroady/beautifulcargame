import * as CANNON from 'cannon-es';

export interface PhysicsWorld {
  world: CANNON.World;
  groundMaterial: CANNON.Material;
  carMaterial: CANNON.Material;
  wallMaterial: CANNON.Material;
  step: (dt: number) => void;
}

const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 5;

export function createPhysicsWorld(): PhysicsWorld {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  (world.solver as CANNON.GSSolver).iterations = 12;
  world.allowSleep = false;

  const groundMaterial = new CANNON.Material('ground');
  const carMaterial = new CANNON.Material('car');
  const wallMaterial = new CANNON.Material('wall');

  // Near-zero contact friction on purpose: cannon builds one friction equation
  // per contact point (a resting box has 4), so even a modest coefficient adds
  // up to more static friction than the engine force — the car freezes solid.
  // All longitudinal/lateral grip is modeled in applyCarControl instead
  // (lateral grip term, linear damping, brake, speed cap), which is the usual
  // arcade-racer approach and behaves identically at every frame rate.
  const carGround = new CANNON.ContactMaterial(groundMaterial, carMaterial, {
    friction: 0.0,
    restitution: 0.05,
  });
  world.addContactMaterial(carGround);

  const carCar = new CANNON.ContactMaterial(carMaterial, carMaterial, {
    friction: 0.15,
    restitution: 0.35,
  });
  world.addContactMaterial(carCar);

  // Walls: frictionless so the car slides ALONG a barrier instead of catching
  // and stopping dead (the default 0.3 friction was pinning cars to the rails),
  // with a little restitution so a hit nudges the car back onto the track.
  const carWall = new CANNON.ContactMaterial(wallMaterial, carMaterial, {
    friction: 0.0,
    restitution: 0.25,
  });
  world.addContactMaterial(carWall);

  let accumulator = 0;
  const step = (dt: number) => {
    // cannon-es never refreshes a body's AABB when its pose is mutated after
    // addBody (in-place position/quaternion writes don't set aabbNeedsUpdate),
    // and world.rayTest silently skips bodies whose stale AABB doesn't overlap
    // the ray — the RaycastVehicle wheels then "find no ground" and the car
    // drops onto its chassis box. Refresh static bodies every frame; the AABB
    // math is trivial next to the solver.
    for (const b of world.bodies) {
      if (b.mass === 0) {
        b.aabbNeedsUpdate = true;
        b.updateAABB();
      }
    }

    accumulator += dt;
    const maxTime = FIXED_STEP * MAX_SUBSTEPS;
    if (accumulator > maxTime) accumulator = maxTime;
    // Controls apply forces once per render frame, but cannon clears body forces
    // after every substep. On slow frames (mobile, weak GPUs) that meant thrust
    // acted for only 1 of up to 5 substeps while friction acted in all of them —
    // the car could barely move below ~50fps. Re-apply the frame's forces before
    // each substep so acceleration is frame-rate independent.
    const forces = world.bodies.map((b) => ({
      b,
      fx: b.force.x, fy: b.force.y, fz: b.force.z,
      tx: b.torque.x, ty: b.torque.y, tz: b.torque.z,
    }));
    let first = true;
    while (accumulator >= FIXED_STEP) {
      if (!first) {
        for (const s of forces) {
          s.b.force.set(s.fx, s.fy, s.fz);
          s.b.torque.set(s.tx, s.ty, s.tz);
        }
      }
      world.step(FIXED_STEP);
      first = false;
      accumulator -= FIXED_STEP;
    }
  };

  return { world, groundMaterial, carMaterial, wallMaterial, step };
}
