import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { addTrees, addLightPoles } from '../effects/scenery';

export const TRACK_OUTER_RADIUS = 26;
export const TRACK_INNER_RADIUS = 15;
const WALL_HEIGHT = 2.5;

/** Checkerboard asphalt-ish texture for the ring road surface. */
function buildAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2c2e33';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random() * canvas.width, 0);
    ctx.lineTo(Math.random() * canvas.width, canvas.height);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A circular guardrail built from short straight box segments — cannon-es has no hollow tube/cylinder-shell shape. */
function buildRingWall(world: CANNON.World, material: CANNON.Material, radius: number, segments = 40) {
  const segmentLength = (2 * Math.PI * radius) / segments;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const body = new CANNON.Body({ mass: 0, material });
    body.addShape(new CANNON.Box(new CANNON.Vec3(0.15, WALL_HEIGHT / 2, segmentLength / 2 + 0.05)));
    body.position.set(Math.cos(angle) * radius, WALL_HEIGHT / 2, Math.sin(angle) * radius);
    body.quaternion.setFromEuler(0, -angle, 0);
    world.addBody(body);
  }
}

/**
 * A ring-shaped (annulus) race circuit. Cars drive around the ring; progress is tracked as the
 * unwrapped angle around the world origin, which works as a robust lap proxy specifically because
 * the inner/outer walls physically prevent shortcuts through the infield.
 */
export class Track {
  group = new THREE.Group();
  outerRadius = TRACK_OUTER_RADIUS;
  innerRadius = TRACK_INNER_RADIUS;

  constructor(scene: THREE.Scene, world: CANNON.World, groundMaterial: CANNON.Material, wallMaterial: CANNON.Material) {
    const roadTex = buildAsphaltTexture();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.95, metalness: 0.02 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(this.innerRadius, this.outerRadius, 64, 1), roadMat);
    ring.rotation.x = -Math.PI / 2;
    ring.receiveShadow = true;
    this.group.add(ring);

    const infieldMat = new THREE.MeshStandardMaterial({ color: 0x1b3a22, roughness: 1 });
    const infield = new THREE.Mesh(new THREE.CircleGeometry(this.innerRadius, 48), infieldMat);
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = -0.02;
    this.group.add(infield);

    // Start/finish line marker at angle 0.
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(this.outerRadius - this.innerRadius, 1.2), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set((this.outerRadius + this.innerRadius) / 2, 0.01, 0);
    this.group.add(line);

    // Low guardrails (visual) at inner/outer edges.
    const railMat = new THREE.MeshStandardMaterial({ color: 0xdd3b3b, roughness: 0.5, metalness: 0.2 });
    const outerRail = new THREE.Mesh(new THREE.TorusGeometry(this.outerRadius, 0.18, 8, 64), railMat);
    outerRail.rotation.x = Math.PI / 2;
    outerRail.position.y = 0.4;
    this.group.add(outerRail);
    const innerRail = new THREE.Mesh(new THREE.TorusGeometry(this.innerRadius, 0.18, 8, 64), railMat);
    innerRail.rotation.x = Math.PI / 2;
    innerRail.position.y = 0.4;
    this.group.add(innerRail);

    scene.add(this.group);

    // Flat ground collider spanning the whole circuit (a wide box is simpler/robust than matching the ring exactly).
    const groundBody = new CANNON.Body({ mass: 0, material: groundMaterial });
    groundBody.addShape(new CANNON.Box(new CANNON.Vec3(this.outerRadius + 2, 0.5, this.outerRadius + 2)));
    groundBody.position.set(0, -0.5, 0);
    world.addBody(groundBody);

    // Inner + outer boundary walls. A single solid cylinder can't work as a hollow guardrail — a car
    // near the middle of the ring would already sit fully inside a solid cylinder's volume, so instead
    // build each wall out of short straight segments arranged around the circle (a "polygon tube").
    buildRingWall(world, wallMaterial, this.outerRadius + 0.3);
    buildRingWall(world, wallMaterial, this.innerRadius - 0.3);

    addLightPoles(scene, this.outerRadius + 3, 12);
    addTrees(scene, this.outerRadius + 5, this.outerRadius + 22, 30);
    addTrees(scene, 0, this.innerRadius - 3, 10);
  }

  /** Radial distance from the track's mid-line for spawn placement. */
  midRadius(): number {
    return (this.outerRadius + this.innerRadius) / 2;
  }
}
