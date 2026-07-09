import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export interface SceneRig {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
}

export function createSceneRig(container: HTMLElement): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  scene.fog = new THREE.Fog(0x05060a, 30, 70);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Baseline scene lighting fill: PBR materials at any real metalness/roughness read far too dark
  // without an environment map to sample, even for the flat platform/hazard meshes, not just the
  // car's metal parts. A generated room environment is a cheap stand-in for a real HDRI.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
  camera.position.set(0, 16, 20);

  const hemi = new THREE.HemisphereLight(0x8899bb, 0x11141a, 0.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2e0, 1.4);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 60;
  scene.add(sun);

  const rimLight = new THREE.PointLight(0xff5030, 0.6, 60);
  rimLight.position.set(-15, 10, -15);
  scene.add(rimLight);

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
  };
  window.addEventListener('resize', resize);
  resize();

  return { scene, renderer, camera, resize };
}

/** Chase-style overhead camera that frames both cars, arcade-derby style. */
export function updateArenaCamera(camera: THREE.PerspectiveCamera, positions: { x: number; z: number }[]) {
  let cx = 0;
  let cz = 0;
  for (const p of positions) {
    cx += p.x;
    cz += p.z;
  }
  cx /= positions.length;
  cz /= positions.length;

  let maxDist = 8;
  for (const p of positions) {
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d > maxDist) maxDist = d;
  }
  const height = Math.min(30, 14 + maxDist * 0.6);
  const back = Math.min(26, 16 + maxDist * 0.4);

  const targetPos = new THREE.Vector3(cx, height, cz + back);
  camera.position.lerp(targetPos, 0.06);
  camera.lookAt(cx, 0, cz);
}
