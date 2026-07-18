import './style.css';
import * as THREE from 'three';
import { createSceneRig, updateArenaCamera, updateChaseCamera } from './sceneSetup';
import { Match } from './game/matchState';
import { MAX_HP } from './game/carEntity';
import { ArcadeRace } from './game/arcadeRace';
import { ParkingMode } from './game/parkingMode';
import { KeyboardInputSource, NEUTRAL_INPUT, type CarInput } from './input/input';
import { Hud } from './ui/hud';
import { ArcadeHud } from './ui/arcadeHud';
import { ParkingHud } from './ui/parkingHud';
import { MainMenu, LobbyScreen, CAR_CHOICES, type MenuSelection, type CarChoice } from './ui/menus';
import { createCarModel, type CarModel } from './car/carModel';
import { loadGltfCar } from './car/gltfCar';
import { Minimap } from './ui/minimap';
import { NetSession } from './net/peer';
import { ClientView } from './net/clientView';
import { ArcadeClientView } from './net/arcadeClientView';
import { INITIAL_RADIUS } from './arena/arena';
import type { StateMessage, RaceStateMessage } from './net/protocol';
import { TouchControls, isTouchDevice, combineInputs } from './ui/touchControls';
import { deriveDerbyBotInput } from './ai/botController';
import { engineSound } from './audio/engineSound';
import type { CarEntity } from './game/carEntity';

// --- Mobile zoom traps -----------------------------------------------------
// iOS Safari ignores user-scalable=no AND touch-action in enough cases that
// double-tap still zooms, and once zoomed (with user-scalable=no) it can't be
// pinched back out — the player is stuck. Kill every zoom gesture in JS.
//
// The reliable double-tap fix is to preventDefault the SECOND tap's *touchstart*
// (that's what iOS turns into a zoom), detected purely by timing. We never touch
// the first tap, so normal taps/clicks keep working; and our controls use
// pointer events, which fire independently of the prevented touch default, so
// steering is unaffected. Excludes the join-code input and the menu (so it can
// still scroll and focus).
const isFormTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || !!t.closest('.menu'));

let lastTouchEndAt = 0;
document.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length > 1) {
      e.preventDefault(); // pinch-zoom
      return;
    }
    if (Date.now() - lastTouchEndAt <= 450 && !isFormTarget(e.target)) {
      e.preventDefault(); // rapid second tap → would zoom
    }
  },
  { passive: false },
);
document.addEventListener('touchend', () => { lastTouchEndAt = Date.now(); }, { passive: true });
// Backstops.
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });
// Selection/context-menu on long-press also hijacks touches (see style.css note).
document.addEventListener('selectstart', (e) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
});
document.addEventListener('contextmenu', (e) => {
  if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
});

const app = document.getElementById('app')!;
const rig = createSceneRig(app);

// "Please rotate" hint — only shown on small screens held in portrait *while
// playing* (CSS gates it on body.playing + orientation). Racing with the arrows
// is far easier in landscape.
const rotateHint = document.createElement('div');
rotateHint.className = 'rotate-hint';
rotateHint.innerHTML = `<div class="rotate-hint-icon">⟳</div><p>Handy quer drehen<br><span class="rotate-hint-sub">Das Spiel startet danach</span></p>`;
app.appendChild(rotateHint);

/** Toggles the body.playing flag that gates in-game-only overlays (rotate hint). */
function setPlaying(on: boolean) {
  document.body.classList.toggle('playing', on);
}

let frameHandle = 0;
function stopLoop() {
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = 0;
}

function clearScene() {
  // Lights and the sky dome are set up once in createSceneRig and must survive every mode switch —
  // only sweep out game content (arena/track/cars/hazards) added on top of that baseline.
  for (const child of [...rig.scene.children]) {
    if (!child.userData.persistent) rig.scene.remove(child);
  }
}

/**
 * Touch driving model for race modes: explicit GAS pedal (real pedals, as
 * requested), and the BREMSE button brakes at speed but *reverses* once the car
 * is nearly stopped — so hitting a wall never leaves you helplessly pinned.
 */
function applyTouchDriveModel(input: CarInput, car: CarEntity): CarInput {
  if (input.brake) {
    const speed = Math.hypot(car.body.velocity.x, car.body.velocity.z);
    if (speed < 3) return { ...input, throttle: -0.75, brake: false }; // back out of the wall
    return input; // still moving: brake normally
  }
  return input;
}

/** Forward direction of a car's physics body projected onto the ground plane. */
function headingOf(car: CarEntity): { x: number; z: number } {
  const f = new THREE.Vector3(1, 0, 0).applyQuaternion(
    new THREE.Quaternion(car.body.quaternion.x, car.body.quaternion.y, car.body.quaternion.z, car.body.quaternion.w),
  );
  const len = Math.hypot(f.x, f.z) || 1;
  return { x: f.x / len, z: f.z / len };
}

// Matches the CSS media query that shows the "please rotate" overlay. While it's
// true, the local game loops freeze so the countdown doesn't tick away and the
// race doesn't start behind the hint — the game waits until the phone is turned.
const portraitQuery = window.matchMedia('(max-width: 900px) and (orientation: portrait)');
function orientationBlocked(): boolean {
  return isTouchDevice() && portraitQuery.matches;
}

function showMenu() {
  stopLoop();
  clearScene();
  setPlaying(false);
  rig.setBoostFov(false);
  engineSound.setEnabled(false); // no engine drone behind the menu
  engineSound.setScreech(false);

  // 3D showroom behind the (translucent) menu: the currently selected car rotating on a plinth.
  const stage = new THREE.Group();
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.8, 0.25, 40),
    new THREE.MeshStandardMaterial({ color: 0x1c1f27, roughness: 0.4, metalness: 0.5 }),
  );
  plinth.position.y = -0.12;
  plinth.receiveShadow = true;
  stage.add(plinth);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(3.6, 0.05, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0xff4a3c, emissive: 0xff2a1c, emissiveIntensity: 1.2 }),
  );
  rim.rotation.x = Math.PI / 2;
  stage.add(rim);
  rig.scene.add(stage);

  let showCar: THREE.Group | null = null;
  let carRequest = 0;
  const setShowroomCar = (choice: CarChoice) => {
    const req = ++carRequest;
    const apply = (model: CarModel) => {
      if (req !== carRequest) return; // a newer selection already replaced this one
      if (showCar) stage.remove(showCar);
      showCar = model.group;
      stage.add(showCar);
    };
    if (choice.modelUrl) {
      loadGltfCar(choice.modelUrl).then(apply).catch(() => apply(createCarModel(choice.color)));
    } else {
      apply(createCarModel(choice.color));
    }
  };
  setShowroomCar(CAR_CHOICES[0]);

  rig.camera.position.set(4.6, 2.4, 5.6);
  rig.camera.lookAt(0, 0.7, 0);

  let last = performance.now();
  function menuLoop(now: number) {
    frameHandle = requestAnimationFrame(menuLoop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    stage.rotation.y += dt * 0.45;
    rig.camera.lookAt(0, 0.7, 0);
    rig.render();
  }
  frameHandle = requestAnimationFrame(menuLoop);

  const menu = new MainMenu(app, {
    onLocal: (sel) => {
      menu.destroy();
      setPlaying(true);
      if (sel.mode === 'race') void startArcadeRace(sel);
      else if (sel.mode === 'parking') startParking(sel);
      else startLocalDerby(sel);
    },
    onHost: (sel) => {
      menu.destroy();
      setPlaying(true);
      startHost(sel);
    },
    onJoin: (code, sel) => {
      menu.destroy();
      setPlaying(true);
      startJoin(code, sel);
    },
  });
  menu.onCarChange = setShowroomCar;
}

// ---------------------------------------------------------------------------
// RENNEN (local): player + AI field, or 2 humans + AI on one keyboard.
// ---------------------------------------------------------------------------
async function startArcadeRace(sel: MenuSelection) {
  stopLoop(); // the menu showroom loop is still ticking
  clearScene();
  engineSound.setEnabled(true);
  const humanCount = sel.vsBot ? 1 : 2;
  // Desktops handle a fuller grid; phones stay at 4 cars for fps headroom.
  const aiCount = sel.vsBot ? (isTouchDevice() ? 3 : 5) : 2;

  // Preload the glTF player car (cached after the menu showroom already displayed it).
  let playerModel: CarModel | undefined;
  if (sel.carModelUrl) {
    try {
      playerModel = await loadGltfCar(sel.carModelUrl);
    } catch {
      playerModel = undefined;
    }
  }

  const cleanup = () => {
    hud.destroy();
    minimap.destroy();
    touch?.destroy();
    engineSound.setScreech(false);
  };
  const hud = new ArcadeHud(app, {
    onRestart: () => {
      cleanup();
      void startArcadeRace(sel);
    },
    onMenu: () => {
      cleanup();
      showMenu();
    },
  });

  // Traffic only in local single-player (it's not in the netcode snapshot, and
  // 2-player shares one screen). Fewer on phones for fps headroom.
  const trafficCount = humanCount === 1 ? (isTouchDevice() ? 4 : 6) : 0;
  const race = new ArcadeRace(
    rig.scene,
    { trackId: sel.trackId, humanCount: humanCount as 1 | 2, aiCount, playerColor: sel.carColor, playerModel, trafficCount },
    {
      onPhaseChange: (phase, data) => {
        if (phase === 'countdown') hud.setCountdown(data?.countdown ?? 0);
      },
      onHud: (h) => hud.setHud(h),
      onFinish: (standings) => hud.showResults(standings),
      onShake: (m) => rig.shake(m),
      onTrafficCleared: () => hud.flash('FREIE BAHN!'),
      onWrongWay: (active) => hud.setWrongWay(active),
    },
  );
  const minimap = new Minimap(app, race.circuit);

  const inputA = new KeyboardInputSource('wasd');
  const inputB = humanCount === 2 ? new KeyboardInputSource('arrows') : null;
  const touch = isTouchDevice() ? new TouchControls(app, 'race') : null;

  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (hud.paused || orientationBlocked()) {
      engineSound.setScreech(false);
      rig.render();
      return;
    }

    let localA = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
    if (touch) localA = applyTouchDriveModel(localA, race.cars[0]);
    const inputs = inputB ? [localA, inputB.read()] : [localA];
    race.update(dt, inputs);

    const playerSpeed = Math.hypot(race.cars[0].body.velocity.x, race.cars[0].body.velocity.z);
    engineSound.update(dt, race.cars[0].speedKmh, Math.abs(localA.throttle), race.racers[0].nitroActive);
    engineSound.setScreech(Math.abs(localA.steer) > 0.6 && playerSpeed > 8);
    rig.setBoostFov(race.racers[0].nitroActive);
    minimap.update(
      race.cars.map((c, i) => ({
        x: c.body.position.x,
        z: c.body.position.z,
        color: i === 0 ? '#40e0a0' : i < race.humanCount ? '#ffffff' : '#ff5050',
      })),
    );

    if (humanCount === 1) {
      const h = headingOf(race.cars[0]);
      const p = race.cars[0].body.position;
      // Dev-only telemetry for automated steering/heading tests.
      if (import.meta.env.DEV) {
        (window as unknown as { __dbg?: object }).__dbg = {
          heading: Math.atan2(h.z, h.x),
          speed: playerSpeed,
          x: p.x,
          z: p.z,
        };
      }
      updateChaseCamera(rig.camera, {
        x: p.x,
        z: p.z,
        headingX: h.x,
        headingZ: h.z,
        speed: Math.hypot(race.cars[0].body.velocity.x, race.cars[0].body.velocity.z),
      });
    } else {
      updateArenaCamera(rig.camera, race.cars.slice(0, 2).map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
    }
    rig.render();
  }
  frameHandle = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// PARKEN
// ---------------------------------------------------------------------------
function startParking(sel: MenuSelection) {
  stopLoop(); // the menu showroom loop is still ticking
  clearScene();
  rig.setCameraTilt(0); // clear any leftover roll from a previous race
  rig.setBoostFov(false);
  engineSound.setEnabled(false); // parking is quiet: only gear clicks, no engine drone
  // Camera views the player can cycle with the ANSICHT button.
  const camModes = ['nah', 'weit', 'verfolg'] as const;
  let camIdx = 0;
  const hud = new ParkingHud(app, {
    onRetry: () => {
      hud.destroy();
      touch?.destroy();
      startParking(sel);
    },
    onMenu: () => {
      hud.destroy();
      touch?.destroy();
      showMenu();
    },
    onToggleCam: () => {
      camIdx = (camIdx + 1) % camModes.length;
    },
  });

  const parking = new ParkingMode(rig.scene, sel.scenario, sel.carColor, {
    onPhaseChange: (phase) => hud.showResult(phase === 'success', parking.time),
    onHud: (h) => hud.setHud(h),
    onShake: (m) => rig.shake(m),
  });

  const input = new KeyboardInputSource('wasd');
  const touch = isTouchDevice() ? new TouchControls(app, 'parking') : null;

  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (hud.paused || orientationBlocked()) {
      rig.render();
      return;
    }

    // Keyboard stays natural (W forward / S reverse); touch uses the gear pedal.
    const localInput = touch ? combineInputs(input.read(), touch.read()) : input.read();
    // Success is checked only when the player shifts to P (touch) or holds the
    // brake to a stop (keyboard).
    const parkEngaged = touch ? touch.gear === 'P' : localInput.brake;
    parking.update(dt, localInput, parkEngaged);

    // Three selectable views (ANSICHT button): a close overhead, a wider
    // overhead, and a low chase behind the car.
    const p = parking.player.body.position;
    const t = parking.targetPos;
    const midX = (p.x + t.x) / 2;
    const midZ = (p.z + t.z) / 2;
    const sep = Math.hypot(p.x - t.x, p.z - t.z);
    const mode = camModes[camIdx];
    if (mode === 'verfolg') {
      // Low chase camera behind the car's facing direction.
      const h = headingOf(parking.player);
      const camTarget = new THREE.Vector3(p.x - h.x * 8, 3.2, p.z - h.z * 8);
      rig.camera.position.lerp(camTarget, 0.12);
      rig.camera.lookAt(p.x + h.x * 4, 0.6, p.z + h.z * 4);
    } else {
      // Overhead framing car + bay; 'nah' sits noticeably lower than 'weit'.
      const base = mode === 'nah' ? 10 : 16;
      const height = base + sep * (mode === 'nah' ? 0.5 : 0.85);
      const camTarget = new THREE.Vector3(midX, height, midZ + (mode === 'nah' ? 5 : 8));
      rig.camera.position.lerp(camTarget, 0.1);
      rig.camera.lookAt(midX, 0, midZ);
    }
    rig.render();
  }
  frameHandle = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// DERBY (local)
// ---------------------------------------------------------------------------
function startLocalDerby(sel: MenuSelection) {
  stopLoop(); // the menu showroom loop is still ticking
  clearScene();
  engineSound.setEnabled(true);
  const cleanup = () => {
    hud.destroy();
    touch?.destroy();
  };
  const hud = new Hud(app, ['SPIELER 1', sel.vsBot ? 'BOT' : 'SPIELER 2'], {
    onRestart: () => {
      cleanup();
      startLocalDerby(sel);
    },
    onMenu: () => {
      cleanup();
      showMenu();
    },
  });
  const match = new Match(
    rig.scene,
    {
      onPhaseChange: (phase, data) => hud.setPhase(phase, data),
      onHpChange: (hp) => hud.setHp(hp, MAX_HP),
      onScoreChange: (score) => hud.setScore(score),
      onCollisionSpark: () => {
        rig.shake(0.12);
        engineSound.playCrash(0.6);
      },
    },
    sel.carColor,
  );
  const inputA = new KeyboardInputSource('wasd');
  const inputB = sel.vsBot ? null : new KeyboardInputSource('arrows');
  const touch = isTouchDevice() ? new TouchControls(app, 'manual') : null;

  let matchEndedAt = 0;
  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (hud.paused || orientationBlocked()) {
      rig.render();
      return;
    }

    const localA = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
    const bInput = sel.vsBot ? deriveDerbyBotInput(match.cars[1], match.cars[0], match.arena.radius) : inputB!.read();
    match.update(dt, localA, bInput);
    if (match.phase === 'matchEnd') {
      if (!matchEndedAt) matchEndedAt = now;
      if (now - matchEndedAt > 4000) {
        matchEndedAt = 0;
        match.resetMatch();
      }
    }

    engineSound.update(dt, match.cars[0].speedKmh, Math.abs(localA.throttle), match.cars[0].nitroSpeedMultiplier > 1);
    hud.setSpeed(match.cars[0].speedKmh);
    rig.setBoostFov(match.cars[0].nitroSpeedMultiplier > 1 || match.cars[1].nitroSpeedMultiplier > 1);
    updateArenaCamera(rig.camera, match.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
    rig.render();
  }
  frameHandle = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// ONLINE host: race → ArcadeRace 2 humans, derby → Match.
// ---------------------------------------------------------------------------
function startHost(sel: MenuSelection) {
  stopLoop(); // the menu showroom loop is still ticking
  clearScene();
  const lobby = new LobbyScreen(app, () => {
    lobby.destroy();
    showMenu();
  });

  let remoteInput: CarInput = NEUTRAL_INPUT;

  const session = new NetSession({
    onStatus: (text) => lobby.setStatus(text),
    onData: (data) => {
      const msg = data as { t: string; input?: CarInput };
      // Older clients may not send the nitro field yet — default it off.
      if (msg.t === 'input' && msg.input) remoteInput = { ...msg.input, nitro: msg.input.nitro ?? false };
    },
    onDisconnected: () => lobby.setStatus('Verbindung getrennt.'),
    onConnected: () => {
      lobby.destroy();
      clearScene();
      engineSound.setEnabled(true);
      const inputA = new KeyboardInputSource('wasd');
      const touch = isTouchDevice() ? new TouchControls(app, sel.mode === 'race' ? 'race' : 'manual') : null;
      let sendAccumulator = 0;
      let last = performance.now();

      if (sel.mode === 'race') {
        const hud = new ArcadeHud(app, {
          onRestart: () => {},
          onMenu: () => {
            session.close();
            hud.destroy();
            touch?.destroy();
            showMenu();
          },
        });
        const race = new ArcadeRace(
          rig.scene,
          { trackId: sel.trackId, humanCount: 2, aiCount: 0, playerColor: sel.carColor },
          {
            onPhaseChange: (phase, data) => {
              if (phase === 'countdown') hud.setCountdown(data?.countdown ?? 0);
            },
            onHud: (h) => hud.setHud(h),
            onFinish: (standings) => hud.showResults(standings),
            onShake: (m) => rig.shake(m),
          },
        );
        const minimap = new Minimap(app, race.circuit);
        function loop(now: number) {
          frameHandle = requestAnimationFrame(loop);
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          let localA = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
          if (touch) localA = applyTouchDriveModel(localA, race.cars[0]);
          race.update(dt, [localA, remoteInput]);
          engineSound.update(dt, race.cars[0].speedKmh, Math.abs(localA.throttle), race.racers[0].nitroActive);
          engineSound.setScreech(Math.abs(localA.steer) > 0.6 && race.cars[0].speedKmh > 30);
          rig.setBoostFov(race.racers[0].nitroActive);
          minimap.update(race.cars.map((c, i) => ({ x: c.body.position.x, z: c.body.position.z, color: i === 0 ? '#40e0a0' : '#ffffff' })));
          sendAccumulator += dt;
          if (sendAccumulator >= 1 / 25) {
            sendAccumulator = 0;
            session.send(race.getSnapshot());
          }
          const h = headingOf(race.cars[0]);
          const p = race.cars[0].body.position;
          updateChaseCamera(rig.camera, { x: p.x, z: p.z, headingX: h.x, headingZ: h.z, speed: Math.hypot(race.cars[0].body.velocity.x, race.cars[0].body.velocity.z) });
          rig.render();
        }
        frameHandle = requestAnimationFrame(loop);
        return;
      }

      const hud = new Hud(app, ['DU (HOST)', 'GEGNER']);
      const match = new Match(
        rig.scene,
        {
          onPhaseChange: (phase, data) => hud.setPhase(phase, data),
          onHpChange: (hp) => hud.setHp(hp, MAX_HP),
          onScoreChange: (score) => hud.setScore(score),
          onCollisionSpark: () => rig.shake(0.12),
        },
        sel.carColor,
      );
      let matchEndedAt = 0;
      function loop(now: number) {
        frameHandle = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        const localInput = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
        match.update(dt, localInput, remoteInput);
        if (match.phase === 'matchEnd') {
          if (!matchEndedAt) matchEndedAt = now;
          if (now - matchEndedAt > 4000) {
            matchEndedAt = 0;
            match.resetMatch();
          }
        }

        engineSound.update(dt, match.cars[0].speedKmh, Math.abs(localInput.throttle), false);
        sendAccumulator += dt;
        if (sendAccumulator >= 1 / 25) {
          sendAccumulator = 0;
          session.send(match.getSnapshot());
        }

        hud.setSpeed(match.cars[0].speedKmh);
        rig.setBoostFov(match.cars[0].nitroSpeedMultiplier > 1 || match.cars[1].nitroSpeedMultiplier > 1);
        updateArenaCamera(rig.camera, match.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
        rig.render();
      }
      frameHandle = requestAnimationFrame(loop);
    },
  });

  session.host().then((code) => {
    lobby.setCode(code);
  });
}

// ---------------------------------------------------------------------------
// ONLINE join: mode is detected from the shape of the host's first snapshot.
// ---------------------------------------------------------------------------
function startJoin(code: string, sel: MenuSelection) {
  stopLoop(); // the menu showroom loop is still ticking
  clearScene();
  const lobby = new LobbyScreen(app, () => {
    lobby.destroy();
    showMenu();
  });

  let latestDerbyState: StateMessage | null = null;
  let latestRaceState: RaceStateMessage | null = null;

  const session = new NetSession({
    onStatus: (text) => lobby.setStatus(text),
    onConnected: () => {
      lobby.destroy();
      clearScene();
      engineSound.setEnabled(true);
      const input = new KeyboardInputSource('wasd');
      const touch = isTouchDevice() ? new TouchControls(app, sel.mode === 'race' ? 'race' : 'manual') : null;
      let sendAccumulator = 0;
      let last = performance.now();
      let derbyHud: Hud | null = null;
      let raceHud: ArcadeHud | null = null;
      let clientMinimap: Minimap | null = null;
      let derbyView: ClientView | null = null;
      let raceView: ArcadeClientView | null = null;
      let prevDerbyHp: [number, number] | null = null;
      let raceResultsShown = false;

      function loop(now: number) {
        frameHandle = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        sendAccumulator += dt;
        if (sendAccumulator >= 1 / 25) {
          sendAccumulator = 0;
          const localInput = touch ? combineInputs(input.read(), touch.read()) : input.read();
          session.send({ t: 'input', input: localInput });
        }

        if (latestRaceState) {
          const s = latestRaceState;
          if (!raceView) {
            raceView = new ArcadeClientView(rig.scene, s.trackId, 0xf0f0f0, sel.carColor);
            clientMinimap = new Minimap(app, raceView.circuit);
            raceHud = new ArcadeHud(app, {
              onRestart: () => {},
              onMenu: () => {
                session.close();
                raceHud?.destroy();
                touch?.destroy();
                showMenu();
              },
            });
          }
          raceView.applyState(s.cars, dt);
          if (s.phase === 'countdown') raceHud!.setCountdown(s.countdown);
          raceHud!.setHud({
            speed: s.cars[1].speed,
            nitro: s.nitro[1],
            lap: Math.min(s.laps[1] + 1, 3),
            totalLaps: 3,
            position: s.places[1],
            carCount: 2,
            time: s.time,
          });
          if (s.phase === 'finished' && !raceResultsShown) {
            raceResultsShown = true;
            raceHud!.showResults([
              { carIndex: s.winner === 1 ? 1 : 0, name: s.winner === 1 ? 'DU' : 'HOST', lap: 3, finished: true, finishTime: s.time },
              { carIndex: s.winner === 1 ? 0 : 1, name: s.winner === 1 ? 'HOST' : 'DU', lap: 3, finished: false, finishTime: 0 },
            ]);
          }
          engineSound.update(dt, s.cars[1].speed, 0.6, s.cars[1].nitroActive);
          rig.setBoostFov(s.cars[1].nitroActive);
          clientMinimap?.update([
            { x: s.cars[0].x, z: s.cars[0].z, color: '#ffffff' },
            { x: s.cars[1].x, z: s.cars[1].z, color: '#40e0a0' },
          ]);
          const h = raceView.headingOf(1);
          const p = raceView.positionOf(1);
          updateChaseCamera(rig.camera, { x: p.x, z: p.z, headingX: h.x, headingZ: h.z, speed: s.cars[1].speed / 3.6 });
        } else if (latestDerbyState) {
          if (!derbyView) {
            derbyView = new ClientView(rig.scene, INITIAL_RADIUS);
            derbyHud = new Hud(app, ['GEGNER (HOST)', 'DU']);
          }
          derbyView.applyState(latestDerbyState, dt);
          derbyHud!.setPhase(latestDerbyState.phase, { winner: latestDerbyState.winner, countdown: latestDerbyState.countdown });
          const hp: [number, number] = [latestDerbyState.cars[0].hp, latestDerbyState.cars[1].hp];
          derbyHud!.setHp(hp, MAX_HP);
          derbyHud!.setScore(latestDerbyState.score);
          derbyHud!.setSpeed(latestDerbyState.cars[1].speed);
          engineSound.update(dt, latestDerbyState.cars[1].speed, 0.6, false);
          rig.setBoostFov(latestDerbyState.cars[0].nitroActive || latestDerbyState.cars[1].nitroActive);
          if (prevDerbyHp && (hp[0] < prevDerbyHp[0] || hp[1] < prevDerbyHp[1])) rig.shake(0.12);
          prevDerbyHp = hp;
          updateArenaCamera(rig.camera, derbyView.carPositions());
        }
        rig.render();
      }
      frameHandle = requestAnimationFrame(loop);
    },
    onData: (data) => {
      const msg = data as { t: string };
      if (msg.t === 'state') latestDerbyState = data as StateMessage;
      else if (msg.t === 'race-state') latestRaceState = data as RaceStateMessage;
    },
    onDisconnected: () => lobby.setStatus('Verbindung getrennt.'),
  });

  session.join(code).catch(() => {
    lobby.setStatus('Konnte nicht beitreten. Code prüfen und erneut versuchen.');
  });
}

// Guard against typos in CAR_CHOICES wiring — the menu always sends one of these colors.
void CAR_CHOICES;

showMenu();
