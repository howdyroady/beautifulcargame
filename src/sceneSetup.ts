import * as THREE from 'three';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export interface SceneRig {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
  render: () => void;
  shake: (magnitude: number) => void;
  setBoostFov: (active: boolean) => void;
  /** Feed the player's current speed (km/h) every frame for speed-dependent effects. */
  setSpeed: (kmh: number) => void;
  /** Set camera roll tilt (radians, positive = lean right). Smoothly interpolated. */
  setCameraTilt: (radians: number) => void;
}

/* ─── Cinematic grade: chromatic aberration + colour grade + vignette + grain.
 * One cheap pass that lifts the whole image toward a high-end arcade-racer look:
 * punchy contrast, boosted saturation, cool shadows / warm highlights, and a
 * soft vignette that frames the action. ─── */
const SpeedFxShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    chromaAmount: { value: 0.0 },
    grainAmount: { value: 0.012 },
    time: { value: 0.0 },
    saturation: { value: 1.16 },
    contrast: { value: 1.07 },
    vignette: { value: 0.24 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float chromaAmount;
    uniform float grainAmount;
    uniform float time;
    uniform float saturation;
    uniform float contrast;
    uniform float vignette;
    varying vec2 vUv;

    vec3 adjustSaturation(vec3 c, float s) {
      float l = dot(c, vec3(0.2125, 0.7154, 0.0721));
      return mix(vec3(l), c, s);
    }

    void main() {
      vec2 dir = vUv - vec2(0.5);
      float d = length(dir);
      float ca = chromaAmount * d;
      float r = texture2D(tDiffuse, vUv + dir * ca).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - dir * ca).b;
      vec3 color = vec3(r, g, b);

      // Contrast about mid-grey, then saturation.
      color = (color - 0.5) * contrast + 0.5;
      color = adjustSaturation(color, saturation);

      // Cinematic split-tone: cool teal shadows, warm highlights.
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = vec3(0.96, 1.00, 1.06);
      vec3 highTint   = vec3(1.07, 1.02, 0.93);
      color *= mix(shadowTint, highTint, smoothstep(0.15, 0.85, luma));

      // Soft vignette.
      color *= mix(1.0, smoothstep(0.92, 0.32, d), vignette);

      // Film grain.
      float grain = (fract(sin(dot(vUv * time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * grainAmount;
      color += grain;

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }
  `,
};

/* ─── Sky dome + starfield ─── */
function buildSkyDome(): THREE.Group {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, '#020308');
  grad.addColorStop(0.22, '#08102a');
  grad.addColorStop(0.42, '#1a1846');
  grad.addColorStop(0.58, '#4a2850');
  grad.addColorStop(0.72, '#c85a3c');
  grad.addColorStop(0.82, '#ff8840');
  grad.addColorStop(0.90, '#2a1828');
  grad.addColorStop(1, '#020204');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const geo = new THREE.SphereGeometry(190, 32, 20);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const dome = new THREE.Mesh(geo, mat);
  dome.renderOrder = -2;
  group.add(dome);

  // Starfield
  const starCount = 600;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) {
    const azimuth = Math.random() * Math.PI * 2;
    const elevation = Math.asin(0.12 + Math.random() * 0.88);
    const r = 180;
    positions[i * 3] = Math.cos(azimuth) * Math.cos(elevation) * r;
    positions[i * 3 + 1] = Math.sin(elevation) * r;
    positions[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elevation) * r;
    sizes[i] = 0.6 + Math.random() * 1.8;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  starGeo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0xd0e4ff,
      size: 1.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.88,
      fog: false,
    }),
  );
  stars.renderOrder = -1;
  group.add(stars);

  // Animated cloud layer (very subtle, rotating slowly)
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = 512;
  cloudCanvas.height = 256;
  const cctx = cloudCanvas.getContext('2d')!;
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 256;
    const r = 20 + Math.random() * 60;
    const g = cctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(60,40,70,0.08)');
    g.addColorStop(1, 'rgba(60,40,70,0)');
    cctx.fillStyle = g;
    cctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const cloudTex = new THREE.CanvasTexture(cloudCanvas);
  cloudTex.wrapS = THREE.RepeatWrapping;
  cloudTex.wrapT = THREE.RepeatWrapping;
  const cloudSphere = new THREE.Mesh(
    new THREE.SphereGeometry(175, 24, 12),
    new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.35,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  cloudSphere.renderOrder = -1;
  group.add(cloudSphere);
  (group as any)._cloudSphere = cloudSphere;

  return group;
}

/* ─── Rain: streaking drops in a box that rides along with the camera. Sells
 * the wet, reflective road. LineSegments (a short vertical streak per drop)
 * read as rain far better than points, and one draw call keeps it free. ─── */
function buildRain(count: number): { object: THREE.LineSegments; update: (camPos: THREE.Vector3, dt: number) => void } {
  const RANGE = 34; // half-extent of the rain box around the camera
  const TOP = 26;
  const positions = new Float32Array(count * 6); // two vertices per drop
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 6] = (Math.random() * 2 - 1) * RANGE;
    positions[i * 6 + 1] = Math.random() * TOP;
    positions[i * 6 + 2] = (Math.random() * 2 - 1) * RANGE;
    speeds[i] = 30 + Math.random() * 16;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x9db8d8,
    transparent: true,
    opacity: 0.32,
    fog: false,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 5;

  const update = (camPos: THREE.Vector3, dt: number) => {
    const arr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      let y = arr.getY(i * 2) - speeds[i] * dt;
      if (y < 0) {
        y = TOP * (0.7 + Math.random() * 0.3);
        arr.setX(i * 2, camPos.x + (Math.random() * 2 - 1) * RANGE);
        arr.setZ(i * 2, camPos.z + (Math.random() * 2 - 1) * RANGE);
      }
      const x = arr.getX(i * 2);
      const z = arr.getZ(i * 2);
      arr.setY(i * 2, y);
      // Streak length scales with fall speed.
      arr.setXYZ(i * 2 + 1, x, y + speeds[i] * 0.035, z);
    }
    arr.needsUpdate = true;
  };
  return { object: lines, update };
}

export function createSceneRig(container: HTMLElement): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03040a);
  scene.fog = new THREE.FogExp2(0x0a0e22, 0.008);
  const skyDome = buildSkyDome();
  skyDome.userData.persistent = true;
  scene.add(skyDome);

  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Night rain — matches the wet clear-coated road. Fewer drops on phones.
  const rain = buildRain(isTouch ? 350 : 700);
  rain.object.userData.persistent = true;
  scene.add(rain.object);

  const renderer = new THREE.WebGLRenderer({ antialias: !isTouch, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  container.appendChild(renderer.domElement);

  // Cinematic overlays (CSS, zero GPU cost)
  const vignette = document.createElement('div');
  vignette.className = 'vignette';
  container.appendChild(vignette);

  const speedlines = document.createElement('div');
  speedlines.className = 'speedlines';
  container.appendChild(speedlines);

  const lensDirt = document.createElement('div');
  lensDirt.className = 'lens-dirt';
  container.appendChild(lensDirt);

  // Environment reflections from the sky dome
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(buildSkyDome());
  scene.environment = pmrem.fromScene(envScene, 0.03).texture;
  scene.environmentIntensity = 2.8;
  pmrem.dispose();

  const baseFov = 56;
  const camera = new THREE.PerspectiveCamera(baseFov, 1, 0.1, 220);
  camera.position.set(0, 16, 20);

  // --- Lighting: dramatic sunset ---
  const hemi = new THREE.HemisphereLight(0x8899cc, 0x0a0c14, 2.2);
  hemi.userData.persistent = true;
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0d0, 2.2);
  sun.position.set(20, 30, 12);
  sun.castShadow = true;
  const shadowRes = isTouch ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.001;
  sun.userData.persistent = true;
  scene.add(sun);

  const rimLight = new THREE.PointLight(0xff4020, 0.8, 70);
  rimLight.position.set(-18, 12, -18);
  rimLight.userData.persistent = true;
  scene.add(rimLight);

  // Cool fill from the opposite side
  const fillLight = new THREE.PointLight(0x2050ff, 0.35, 60);
  fillLight.position.set(15, 8, 15);
  fillLight.userData.persistent = true;
  scene.add(fillLight);

  // --- Post-processing ---
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Punchier neon glow (Asphalt-style): stronger, wider, lower threshold so the
  // guardrails, taillights and city lights bloom without washing the road out.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.58, 0.42, 0.82);
  composer.addPass(bloom);

  const speedFx = new ShaderPass(SpeedFxShader);
  speedFx.uniforms.grainAmount.value = isTouch ? 0.008 : 0.014;
  composer.addPass(speedFx);

  // The EffectComposer renders into an offscreen buffer, which bypasses the
  // renderer's own MSAA — so every edge was jagged (the classic "cheap 3D"
  // tell). One cheap FXAA pass restores anti-aliasing on every device.
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  composer.addPass(new OutputPass());

  let shakeMagnitude = 0;
  let shakeDecayTimer = 0;
  let boostFovActive = false;
  let currentFov = baseFov;
  let currentSpeed = 0;
  let targetTilt = 0;
  let currentTilt = 0;
  let frameTime = 0;

  const resize = () => {
    const { clientWidth, clientHeight } = container;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
    composer.setSize(clientWidth, clientHeight);
    bloom.setSize(clientWidth, clientHeight);
    const pr = renderer.getPixelRatio();
    fxaa.material.uniforms['resolution'].value.set(1 / (clientWidth * pr), 1 / (clientHeight * pr));
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  const render = () => {
    frameTime += 1 / 60;

    // FOV: wider during boost or very high speed
    const speedFovBonus = Math.min(6, currentSpeed * 0.015);
    const targetFov = (boostFovActive ? baseFov + 14 : baseFov) + speedFovBonus;
    currentFov += (targetFov - currentFov) * 0.07;
    if (Math.abs(currentFov - camera.fov) > 0.02) {
      camera.fov = currentFov;
      camera.updateProjectionMatrix();
    }

    // Camera tilt (roll). NEVER assign camera.rotation.z directly: lookAt() can
    // decompose to euler angles with z ≈ ±π once the view direction passes ±90°
    // yaw, and overwriting that component flips the whole camera — the screen
    // suddenly "rotated 360°" mid-corner. rotateZ() applies a pure roll around
    // the view axis on top of whatever lookAt set, which is what we mean.
    currentTilt += (targetTilt - currentTilt) * 0.06;
    if (Math.abs(currentTilt) > 0.0005) camera.rotateZ(currentTilt);

    // Camera shake
    if (shakeDecayTimer > 0) {
      shakeDecayTimer -= 1 / 60;
      const s = shakeMagnitude * Math.max(0, shakeDecayTimer);
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
    }

    // Speed-dependent chromatic aberration
    const normalizedSpeed = Math.min(1, currentSpeed / 280);
    speedFx.uniforms.chromaAmount.value = normalizedSpeed * 0.015 + (boostFovActive ? 0.012 : 0);
    speedFx.uniforms.time.value = frameTime * 60;

    // Rotate cloud layer slowly
    const cloudSphere = (skyDome as any)._cloudSphere as THREE.Mesh | undefined;
    if (cloudSphere) cloudSphere.rotation.y += 0.0001;

    rain.update(camera.position, 1 / 60);

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
      lensDirt.classList.toggle('on', active);
    },
    setSpeed: (kmh: number) => {
      currentSpeed = kmh;
    },
    setCameraTilt: (radians: number) => {
      targetTilt = radians;
    },
  };
}

/** Chase-style overhead camera for derby/2-player. */
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

/** Asphalt-style chase cam: tight behind the car, drops with speed, cinematic lag. */
export function updateChaseCamera(
  camera: THREE.PerspectiveCamera,
  target: { x: number; z: number; headingX: number; headingZ: number; speed: number },
) {
  // Tighter framing: the car fills more of the screen, which reads faster and
  // makes squeezing through traffic feel closer.
  const back = 6.4 + Math.min(3.2, target.speed * 0.1);
  const height = 2.5 + Math.min(1.4, target.speed * 0.03);
  const lookAhead = 7.5 + Math.min(4, target.speed * 0.2);
  const desired = new THREE.Vector3(
    target.x - target.headingX * back,
    height,
    target.z - target.headingZ * back,
  );
  // Cinematic lag: camera follows more slowly at high speed (dramatic)
  const lag = 0.075 + Math.min(0.025, target.speed * 0.001);
  camera.position.lerp(desired, lag);
  camera.lookAt(
    target.x + target.headingX * lookAhead,
    0.9,
    target.z + target.headingZ * lookAhead,
  );
}
