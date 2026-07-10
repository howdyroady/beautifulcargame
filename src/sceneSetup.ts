import * as THREE from 'three';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface SceneRig {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
  render: () => void;
  /** One-shot camera shake, e.g. on a heavy collision. Magnitude in world units. */
  shake: (magnitude: number) => void;
  /** Smoothly biases the camera's FOV wider (speed sensation) toward the given target each frame. */
  setBoostFov: (active: boolean) => void;
}

/** Gradient sky dome + starfield — kept fully independent of scene.background/environment so a
 *  texture problem here can never blank out the lit scene (bit us once already). */
function buildSkyDome(): THREE.Group {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#04050c');
  grad.addColorStop(0.35, '#0d1330');
  grad.addColorStop(0.62, '#3a2550');
  grad.addColorStop(0.78, '#c85a3c');
  grad.addColorStop(0.86, '#1a1220');
  grad.addColorStop(1, '#020204');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.SphereGeometry(180, 24, 16);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -1;
  group.add(dome);

  // Starfield across the upper hemisphere; bloom makes the brighter ones twinkle-glow.
  const starCount = 350;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const azimuth = Math.random() * Math.PI * 2;
    const elevation = Math.asin(0.15 + Math.random() * 0.85); // keep off the horizon band
    const r = 172;
    positions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * r;
    positions[i * 3 + 1] = Math.sin(elevation) * r;
    positions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false }),
  );
  stars.renderOrder = -1;
  group.add(stars);
  return group;
}

export function createSceneRig(container: HTMLElement): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04050c);
  scene.fog = new THREE.Fog(0x0d1330, 34, 90);
  const skyDome = buildSkyDome();
  skyDome.userData.persistent = true;
  scene.add(skyDome);

  // Phones get a lower pixel-ratio cap and smaller shadow maps — high-DPI mobile screens
  // otherwise push 3-4x the fragments of a laptop and tank straight below 30fps.
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  container.appendChild(vignette);

  // Radial speed streaks, faded in while nitro is active (pure CSS, zero GPU cost).
  const speedlines = document.createElement('div');
  speedlines.className = 'speedlines';
  container.appendChild(speedlines);

  // Environment reflections come from the actual sunset sky dome instead of a generic room —
  // the clearcoat car paint mirrors the horizon gradient, which reads far more "real".
  // Direct lights below are raised to compensate for the darker ambient this produces.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(buildSkyDome());
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
  scene.environmentIntensity = 2.4;
  pmrem.dispose();

  const baseFov = 58;
  const camera = new THREE.PerspectiveCamera(baseFov, 1, 0.1, 200);
  camera.position.set(0, 16, 20);

  const hemi = new THREE.HemisphereLight(0x8899bb, 0x11141a, 2.0);
  hemi.userData.persistent = true;
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2e0, 1.9);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 60;
  sun.userData.persistent = true;
  scene.add(sun);

  const rimLight = new THREE.PointLight(0xff5030, 0.6, 60);
  rimLight.position.set(-15, 10, -15);
  rimLight.userData.persistent = true;
  scene.add(rimLight);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Threshold close to 1 so only genuinely emissive things glow (neon, LEDs, pickups) —
  // a lower threshold made bright-but-lit surfaces like road markings bloom into a white haze.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.35, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let shakeMagnitude = 0;
  let shakeDecayTimer = 0;
  let boostFovActive = false;
  let currentFov = baseFov;

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
    composer.setSize(clientWidth, clientHeight);
    bloom.setSize(clientWidth, clientHeight);
  };
  window.addEventListener('resize', resize);
  // Mobile browsers resize the *visual* viewport (address bar show/hide) without always firing a
  // plain window 'resize' — listen to that too so the canvas/HUD track the real visible area.
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  const render = () => {
    const targetFov = boostFovActive ? baseFov + 10 : baseFov;
    currentFov += (targetFov - currentFov) * 0.08;
    if (Math.abs(currentFov - camera.fov) > 0.01) {
      camera.fov = currentFov;
      camera.updateProjectionMatrix();
    }

    if (shakeDecayTimer > 0) {
      shakeDecayTimer -= 1 / 60;
      const s = shakeMagnitude * Math.max(0, shakeDecayTimer);
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
    }

    composer.render();
  };

  return {
    scene,
    renderer,
    camera,
    resize,
    render,
    shake: (magnitude: number) => {
      shakeMagnitude = magnitude;
      shakeDecayTimer = 0.35;
    },
    setBoostFov: (active: boolean) => {
      boostFovActive = active;
      speedlines.classList.toggle('on', active);
    },
  };
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

/** Asphalt-style chase camera: sits behind the car along its heading, drops lower and pulls back with speed. */
export function updateChaseCamera(
  camera: THREE.PerspectiveCamera,
  target: { x: number; z: number; headingX: number; headingZ: number; speed: number },
) {
  const back = 8 + Math.min(4, target.speed * 0.12);
  const height = 3.6 + Math.min(1.5, target.speed * 0.03);
  const desired = new THREE.Vector3(
    target.x - target.headingX * back,
    height,
    target.z - target.headingZ * back,
  );
  camera.position.lerp(desired, 0.09);
  camera.lookAt(target.x + target.headingX * 6, 1.1, target.z + target.headingZ * 6);
}
