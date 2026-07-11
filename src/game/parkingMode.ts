import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { createPhysicsWorld } from '../physics/world';
import { CarEntity } from './carEntity';
import { createCarModel } from '../car/carModel';
import { ParticlePool } from '../effects/particles';
import { addLightPoles } from '../effects/scenery';
import type { CarInput } from '../input/input';
import { engineSound } from '../audio/engineSound';

export type ParkingScenario = 'vorwaerts' | 'rueckwaerts' | 'seitwaerts';
export type ParkingPhase = 'driving' | 'success' | 'failed';

export interface ParkingCallbacks {
  onPhaseChange?: (phase: ParkingPhase) => void;
  onHud?: (hud: { hits: number; maxHits: number; time: number; hint: string }) => void;
  onShake?: (m: number) => void;
}

const MAX_HITS = 3;
const BAY_W = 3.0;
const BAY_D = 6.2;

interface BayPose {
  x: number;
  z: number;
  /** Heading of the bay's "nose-in" direction. */
  angle: number;
}

interface ScenarioDef {
  hint: string;
  target: BayPose;
  spawn: { x: number; z: number; angle: number };
  /** Poses of static filler cars. */
  parked: BayPose[];
  /** If true, the car must end up facing OUT of the bay (reverse parking). */
  reversed: boolean;
}

// Angle convention everywhere in this file: world heading θ = atan2(z, x) of where the car's
// NOSE points when parked nose-in. The bay row sits along z=-12 and is entered from the lot
// (z > -12), so its nose-in direction is -z ⇒ θ = -π/2. The parallel strip runs along the right
// wall with cars pointing +z ⇒ θ = +π/2. (CarEntity yaw is -θ; see spawn below.)
function scenarioFor(kind: ParkingScenario): ScenarioDef {
  const bayX = (i: number) => -12 + i * (BAY_W + 0.6);
  const rowBays: BayPose[] = Array.from({ length: 8 }, (_, i) => ({ x: bayX(i), z: -12, angle: -Math.PI / 2 }));
  switch (kind) {
    case 'vorwaerts':
      return {
        hint: 'Fahre VORWÄRTS in die grüne Lücke',
        target: rowBays[3],
        spawn: { x: bayX(3), z: 5, angle: -Math.PI / 2 },
        parked: [rowBays[1], rowBays[2], rowBays[4], rowBays[5], rowBays[6]],
        reversed: false,
      };
    case 'rueckwaerts':
      return {
        hint: 'Setze RÜCKWÄRTS in die grüne Lücke',
        target: rowBays[4],
        spawn: { x: bayX(4) - 5, z: 2, angle: 0 },
        parked: [rowBays[2], rowBays[3], rowBays[5], rowBays[6]],
        reversed: true,
      };
    case 'seitwaerts': {
      const strip = (i: number): BayPose => ({ x: 15, z: -8 + i * (BAY_D + 0.8), angle: Math.PI / 2 });
      return {
        hint: 'Parke SEITWÄRTS zwischen den Autos ein',
        target: strip(1),
        spawn: { x: 10.5, z: -10, angle: Math.PI / 2 },
        parked: [strip(0), strip(2)],
        reversed: false,
      };
    }
  }
}

/**
 * Dr.-Parking-style solo mode: maneuver into the highlighted bay without hitting the parked cars.
 * Success requires the car centered in the bay, aligned within tolerance, and stationary for ~1s.
 */
export class ParkingMode {
  scene: THREE.Scene;
  physics = createPhysicsWorld();
  player: CarEntity;
  particles: ParticlePool;
  phase: ParkingPhase = 'driving';
  hits = 0;
  time = 0;
  private def: ScenarioDef;
  private callbacks: ParkingCallbacks;
  private settleTimer = 0;
  private lastHitAt = -10;

  /** World position of the target bay — used to frame the camera on car + goal. */
  get targetPos(): { x: number; z: number } {
    return { x: this.def.target.x, z: this.def.target.z };
  }

  constructor(scene: THREE.Scene, scenario: ParkingScenario, playerColor: number, callbacks: ParkingCallbacks = {}) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.def = scenarioFor(scenario);
    this.particles = new ParticlePool(scene, 40);

    this.buildLot();
    this.buildTargetMarker();
    this.buildParkedCars();

    this.player = new CarEntity(
      scene,
      this.physics.world,
      this.physics.carMaterial,
      playerColor,
      new CANNON.Vec3(this.def.spawn.x, 1.0, this.def.spawn.z),
      // CarEntity yaw ψ rotates +x about +Y, giving forward (cos ψ, 0, -sin ψ) ⇒ ψ = -θ.
      -this.def.spawn.angle,
    );

    this.player.body.addEventListener('collide', (event: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      const impact = Math.abs(event.contact.getImpactVelocityAlongNormal());
      const tagged = (event.body as unknown as { userData?: { obstacle?: boolean } }).userData?.obstacle;
      if (!tagged || impact < 1.2 || this.time - this.lastHitAt < 0.8 || this.phase !== 'driving') return;
      this.lastHitAt = this.time;
      this.hits++;
      engineSound.playCrash(Math.min(1, impact / 10));
      this.callbacks.onShake?.(0.1);
      if (this.hits >= MAX_HITS) {
        this.phase = 'failed';
        this.callbacks.onPhaseChange?.('failed');
      }
    });
  }

  private buildLot() {
    // Painted concrete ground.
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#26282d';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 250; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.1)';
      ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 44), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const groundBody = new CANNON.Body({ mass: 0, material: this.physics.groundMaterial });
    groundBody.addShape(new CANNON.Box(new CANNON.Vec3(60, 0.5, 44)));
    groundBody.position.set(0, -0.5, 0);
    this.physics.world.addBody(groundBody);

    // Perimeter walls (count as obstacles).
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6a6e78, roughness: 0.8 });
    const walls: { x: number; z: number; w: number; d: number }[] = [
      { x: 0, z: -21, w: 60, d: 1 },
      { x: 0, z: 21, w: 60, d: 1 },
      { x: -29.5, z: 0, w: 1, d: 44 },
      { x: 29.5, z: 0, w: 1, d: 44 },
    ];
    for (const w of walls) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, 1.2, w.d), wallMat);
      mesh.position.set(w.x, 0.6, w.z);
      this.scene.add(mesh);
      const body = new CANNON.Body({ mass: 0 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(w.w / 2, 0.6, w.d / 2)));
      body.position.set(w.x, 0.6, w.z);
      (body as unknown as { userData?: unknown }).userData = { obstacle: true };
      this.physics.world.addBody(body);
    }

    // Bay line markings for the whole row (visual only).
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i <= 8; i++) {
      const x = -12 + i * (BAY_W + 0.6) - (BAY_W + 0.6) / 2 + BAY_W / 2 + 0.3;
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, BAY_D), lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x - BAY_W / 2 - 0.3, 0.02, -12);
      this.scene.add(line);
    }

    addLightPoles(this.scene, 26, 6);
  }

  private buildTargetMarker() {
    const t = this.def.target;
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(BAY_W - 0.2, BAY_D - 0.2),
      new THREE.MeshBasicMaterial({ color: 0x30e080, transparent: true, opacity: 0.28 }),
    );
    marker.rotation.x = -Math.PI / 2;
    // Plane depth (local Y) lands on world -Z after the X-rotation; spin it to match the bay's nose axis.
    marker.rotation.z = t.angle + Math.PI / 2;
    marker.position.set(t.x, 0.03, t.z);
    this.scene.add(marker);
  }

  private buildParkedCars() {
    const colors = [0x30354a, 0x7a2a2a, 0x2a5a3a, 0x555a64, 0x84683c];
    this.def.parked.forEach((pose, i) => {
      const model = createCarModel(colors[i % colors.length]);
      model.group.position.set(pose.x, 0, pose.z);
      model.group.rotation.y = -pose.angle;
      this.scene.add(model.group);

      const body = new CANNON.Body({ mass: 0 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(2.3, 0.7, 0.93)));
      body.position.set(pose.x, 0.7, pose.z);
      body.quaternion.setFromEuler(0, -pose.angle, 0);
      (body as unknown as { userData?: unknown }).userData = { obstacle: true };
      this.physics.world.addBody(body);
    });
  }

  update(dt: number, input: CarInput) {
    this.particles.update(dt);
    if (this.phase !== 'driving') return;
    this.time += dt;

    // Parking wants a low top speed and precise stops, not the racing glide.
    this.player.update(dt, input, { friction: 0.4, boostX: 0, boostZ: 0 }, this.particles);

    // Extra rolling resistance so the car settles quickly when you ease off — with
    // near-zero contact friction it would otherwise coast far past the bay.
    const coasting = input.throttle === 0;
    const damp = coasting ? 0.9 : 0.965;
    this.player.body.velocity.x *= damp;
    this.player.body.velocity.z *= damp;

    this.physics.step(dt);
    this.checkSuccess(dt);

    this.callbacks.onHud?.({ hits: this.hits, maxHits: MAX_HITS, time: this.time, hint: this.def.hint });
  }

  private checkSuccess(dt: number) {
    const t = this.def.target;
    const p = this.player.body.position;
    // Into bay-local frame: u along bay depth (nose direction), v across.
    const dx = p.x - t.x;
    const dz = p.z - t.z;
    const cos = Math.cos(t.angle);
    const sin = Math.sin(t.angle);
    const u = dx * cos + dz * sin;
    const v = -dx * sin + dz * cos;

    const f = new CANNON.Vec3(1, 0, 0);
    this.player.body.quaternion.vmult(f, f);
    const heading = Math.atan2(f.z, f.x);
    let angleDiff = Math.abs(normalizeAngle(heading - (this.def.reversed ? t.angle + Math.PI : t.angle)));
    // Forward/parallel parking accepts either direction of alignment; reverse explicitly requires nose-out.
    if (!this.def.reversed) angleDiff = Math.min(angleDiff, Math.abs(normalizeAngle(heading - t.angle - Math.PI)));

    const speed = Math.hypot(this.player.body.velocity.x, this.player.body.velocity.z);
    const inside = Math.abs(u) < (BAY_D - 4.6) / 2 + 0.55 && Math.abs(v) < (BAY_W - 1.78) / 2 + 0.35;
    const aligned = angleDiff < 0.22;

    if (inside && aligned && speed < 0.4) {
      this.settleTimer += dt;
      if (this.settleTimer > 0.9) {
        this.phase = 'success';
        this.callbacks.onPhaseChange?.('success');
      }
    } else {
      this.settleTimer = 0;
    }
  }
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
