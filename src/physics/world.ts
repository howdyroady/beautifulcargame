import * as CANNON from 'cannon-es';

export interface PhysicsWorld {
  world: CANNON.World;
  groundMaterial: CANNON.Material;
  carMaterial: CANNON.Material;
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

  const carGround = new CANNON.ContactMaterial(groundMaterial, carMaterial, {
    friction: 0.35,
    restitution: 0.05,
  });
  world.addContactMaterial(carGround);

  const carCar = new CANNON.ContactMaterial(carMaterial, carMaterial, {
    friction: 0.15,
    restitution: 0.35,
  });
  world.addContactMaterial(carCar);

  let accumulator = 0;
  const step = (dt: number) => {
    accumulator += dt;
    const maxTime = FIXED_STEP * MAX_SUBSTEPS;
    if (accumulator > maxTime) accumulator = maxTime;
    while (accumulator >= FIXED_STEP) {
      world.step(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  };

  return { world, groundMaterial, carMaterial, step };
}
