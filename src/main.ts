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
import { MainMenu, LobbyScreen, CAR_CHOICES, type MenuSelection } from './ui/menus';
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
// iOS Safari ignores user-scalable=no: pinch and double-tap still zoom, and once zoomed the
// pointer coordinates no longer match layout space — the joystick reads garbage and the player
// is stuck. Block both gestures at the document level.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350) e.preventDefault(); // double-tap zoom
    lastTouchEnd = now;
  },
  { passive: false },
);

const app = document.getElementById('app')!;
const rig = createSceneRig(app);

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

/** Forward direction of a car's physics body projected onto the ground plane. */
function headingOf(car: CarEntity): { x: number; z: number } {
  const f = new THREE.Vector3(1, 0, 0).applyQuaternion(
    new THREE.Quaternion(car.body.quaternion.x, car.body.quaternion.y, car.body.quaternion.z, car.body.quaternion.w),
  );
  const len = Math.hypot(f.x, f.z) || 1;
  return { x: f.x / len, z: f.z / len };
}

function showMenu() {
  stopLoop();
  clearScene();
  rig.camera.position.set(0, 16, 20);
  rig.setBoostFov(false);
  const menu = new MainMenu(app, {
    onLocal: (sel) => {
      menu.destroy();
      if (sel.mode === 'race') startArcadeRace(sel);
      else if (sel.mode === 'parking') startParking(sel);
      else startLocalDerby(sel);
    },
    onHost: (sel) => {
      menu.destroy();
      startHost(sel);
    },
    onJoin: (code, sel) => {
      menu.destroy();
      startJoin(code, sel);
    },
  });
}

// ---------------------------------------------------------------------------
// RENNEN (local): player + AI field, or 2 humans + AI on one keyboard.
// ---------------------------------------------------------------------------
function startArcadeRace(sel: MenuSelection) {
  clearScene();
  const humanCount = sel.vsBot ? 1 : 2;
  const aiCount = sel.vsBot ? 3 : 2;

  const hud = new ArcadeHud(app, {
    onRestart: () => {
      hud.destroy();
      touch?.destroy();
      startArcadeRace(sel);
    },
    onMenu: () => {
      hud.destroy();
      touch?.destroy();
      showMenu();
    },
  });

  const race = new ArcadeRace(
    rig.scene,
    { trackId: sel.trackId, humanCount: humanCount as 1 | 2, aiCount, playerColor: sel.carColor },
    {
      onPhaseChange: (phase, data) => {
        if (phase === 'countdown') hud.setCountdown(data?.countdown ?? 0);
      },
      onHud: (h) => hud.setHud(h),
      onFinish: (standings) => hud.showResults(standings),
      onShake: (m) => rig.shake(m),
    },
  );

  const inputA = new KeyboardInputSource('wasd');
  const inputB = humanCount === 2 ? new KeyboardInputSource('arrows') : null;
  const touch = isTouchDevice() ? new TouchControls(app) : null;

  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const localA = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
    const inputs = inputB ? [localA, inputB.read()] : [localA];
    race.update(dt, inputs);

    engineSound.update(dt, race.cars[0].speedKmh, Math.abs(localA.throttle), race.racers[0].nitroActive);
    rig.setBoostFov(race.racers[0].nitroActive);

    if (humanCount === 1) {
      const h = headingOf(race.cars[0]);
      const p = race.cars[0].body.position;
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
  clearScene();
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
  });

  const parking = new ParkingMode(rig.scene, sel.scenario, sel.carColor, {
    onPhaseChange: (phase) => hud.showResult(phase === 'success', parking.time),
    onHud: (h) => hud.setHud(h),
    onShake: (m) => rig.shake(m),
  });

  const input = new KeyboardInputSource('wasd');
  const touch = isTouchDevice() ? new TouchControls(app) : null;

  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const localInput = touch ? combineInputs(input.read(), touch.read()) : input.read();
    parking.update(dt, localInput);
    engineSound.update(dt, parking.player.speedKmh, Math.abs(localInput.throttle) * 0.6, false);

    // High, slightly tilted top-down view — you need to see the whole bay while maneuvering.
    const p = parking.player.body.position;
    const camTarget = new THREE.Vector3(p.x, 20, p.z + 9);
    rig.camera.position.lerp(camTarget, 0.08);
    rig.camera.lookAt(p.x, 0, p.z);
    rig.render();
  }
  frameHandle = requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// DERBY (local)
// ---------------------------------------------------------------------------
function startLocalDerby(sel: MenuSelection) {
  clearScene();
  const hud = new Hud(app, ['SPIELER 1', sel.vsBot ? 'BOT' : 'SPIELER 2']);
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
  const touch = isTouchDevice() ? new TouchControls(app) : null;

  let matchEndedAt = 0;
  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

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
      const inputA = new KeyboardInputSource('wasd');
      const touch = isTouchDevice() ? new TouchControls(app) : null;
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
        function loop(now: number) {
          frameHandle = requestAnimationFrame(loop);
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          const localA = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
          race.update(dt, [localA, remoteInput]);
          engineSound.update(dt, race.cars[0].speedKmh, Math.abs(localA.throttle), race.racers[0].nitroActive);
          rig.setBoostFov(race.racers[0].nitroActive);
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
      const input = new KeyboardInputSource('wasd');
      const touch = isTouchDevice() ? new TouchControls(app) : null;
      let sendAccumulator = 0;
      let last = performance.now();
      let derbyHud: Hud | null = null;
      let raceHud: ArcadeHud | null = null;
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
