import './style.css';
import { createSceneRig, updateArenaCamera } from './sceneSetup';
import { Match } from './game/matchState';
import { MAX_HP } from './game/carEntity';
import { RaceMatch } from './game/raceState';
import { KeyboardInputSource, NEUTRAL_INPUT, type CarInput } from './input/input';
import { Hud } from './ui/hud';
import { RaceHud } from './ui/raceHud';
import { MainMenu, LobbyScreen, type GameMode } from './ui/menus';
import { NetSession } from './net/peer';
import { ClientView } from './net/clientView';
import { RaceClientView } from './net/raceClientView';
import { INITIAL_RADIUS } from './arena/arena';
import type { StateMessage, RaceStateMessage } from './net/protocol';
import { TouchControls, isTouchDevice, combineInputs } from './ui/touchControls';
import { deriveDerbyBotInput, deriveRaceBotInput } from './ai/botController';

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

function showMenu() {
  stopLoop();
  clearScene();
  rig.camera.position.set(0, 16, 20);
  const menu = new MainMenu(app, {
    onLocal: (mode, vsBot) => {
      menu.destroy();
      if (mode === 'race') startLocalRace(vsBot);
      else startLocalMatch(vsBot);
    },
    onHost: (mode) => {
      menu.destroy();
      startHost(mode);
    },
    onJoin: (code) => {
      menu.destroy();
      startJoin(code);
    },
  });
}

function startLocalMatch(vsBot: boolean) {
  clearScene();
  const hud = new Hud(app, ['SPIELER 1', vsBot ? 'BOT' : 'SPIELER 2']);
  const match = new Match(rig.scene, {
    onPhaseChange: (phase, data) => hud.setPhase(phase, data),
    onHpChange: (hp) => hud.setHp(hp, MAX_HP),
    onScoreChange: (score) => hud.setScore(score),
    onCollisionSpark: () => rig.shake(0.12),
  });
  const inputA = new KeyboardInputSource('wasd');
  const inputB = vsBot ? null : new KeyboardInputSource('arrows');
  // Mobile has no physical keyboard — player 1 always gets an on-screen joystick so local play
  // (vs. bot in particular) is actually controllable on a phone.
  const touch = isTouchDevice() ? new TouchControls(app) : null;

  let matchEndedAt = 0;
  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const localInputA = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
    const inputBValue = vsBot ? deriveDerbyBotInput(match.cars[1], match.cars[0], match.arena.radius) : inputB!.read();
    match.update(dt, localInputA, inputBValue);
    if (match.phase === 'matchEnd') {
      if (!matchEndedAt) matchEndedAt = now;
      if (now - matchEndedAt > 4000) {
        matchEndedAt = 0;
        match.resetMatch();
      }
    }

    hud.setSpeed(match.cars[0].speedKmh);
    rig.setBoostFov(match.cars[0].nitroSpeedMultiplier > 1 || match.cars[1].nitroSpeedMultiplier > 1);
    updateArenaCamera(rig.camera, match.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
    rig.render();
  }
  frameHandle = requestAnimationFrame(loop);
}

function startLocalRace(vsBot: boolean) {
  clearScene();
  const hud = new RaceHud(app, ['SPIELER 1', vsBot ? 'BOT' : 'SPIELER 2']);
  const race = new RaceMatch(rig.scene, {
    onPhaseChange: (phase, data) => hud.setPhase(phase, data),
    onProgress: (laps, places) => hud.setProgress(laps, places),
  });
  const inputA = new KeyboardInputSource('wasd');
  const inputB = vsBot ? null : new KeyboardInputSource('arrows');
  const touch = isTouchDevice() ? new TouchControls(app) : null;
  const trackMidRadius = race.track.midRadius();

  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const localInputA = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
    const inputBValue = vsBot ? deriveRaceBotInput(race.cars[1], trackMidRadius) : inputB!.read();
    race.update(dt, localInputA, inputBValue);
    hud.setSpeed(race.cars[0].speedKmh);
    updateArenaCamera(rig.camera, race.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
    rig.render();
  }
  frameHandle = requestAnimationFrame(loop);
}

function startHost(mode: GameMode) {
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
      if (msg.t === 'input' && msg.input) remoteInput = msg.input;
    },
    onDisconnected: () => lobby.setStatus('Verbindung getrennt.'),
    onConnected: () => {
      lobby.destroy();
      clearScene();
      const inputA = new KeyboardInputSource('wasd');
      const touch = isTouchDevice() ? new TouchControls(app) : null;
      let sendAccumulator = 0;
      let last = performance.now();

      if (mode === 'race') {
        const hud = new RaceHud(app, ['DU (HOST)', 'GEGNER']);
        const race = new RaceMatch(rig.scene, {
          onPhaseChange: (phase, data) => hud.setPhase(phase, data),
          onProgress: (laps, places) => hud.setProgress(laps, places),
        });
        function loop(now: number) {
          frameHandle = requestAnimationFrame(loop);
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          const localInput = touch ? combineInputs(inputA.read(), touch.read()) : inputA.read();
          race.update(dt, localInput, remoteInput);
          sendAccumulator += dt;
          if (sendAccumulator >= 1 / 25) {
            sendAccumulator = 0;
            session.send(race.getSnapshot());
          }
          hud.setSpeed(race.cars[0].speedKmh);
          updateArenaCamera(rig.camera, race.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
          rig.render();
        }
        frameHandle = requestAnimationFrame(loop);
        return;
      }

      const hud = new Hud(app, ['DU (HOST)', 'GEGNER']);
      const match = new Match(rig.scene, {
        onPhaseChange: (phase, data) => hud.setPhase(phase, data),
        onHpChange: (hp) => hud.setHp(hp, MAX_HP),
        onScoreChange: (score) => hud.setScore(score),
        onCollisionSpark: () => rig.shake(0.12),
      });
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

/** The joining client doesn't pick a mode — it detects derby vs. race from the shape of the host's first snapshot. */
function startJoin(code: string) {
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
      let hud: Hud | RaceHud | null = null;
      let derbyView: ClientView | null = null;
      let raceView: RaceClientView | null = null;
      let prevDerbyHp: [number, number] | null = null;

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
          if (!raceView) {
            raceView = new RaceClientView(rig.scene);
            hud = new RaceHud(app, ['GEGNER (HOST)', 'DU']);
          }
          raceView.applyState(latestRaceState.cars, dt);
          (hud as RaceHud).setPhase(latestRaceState.phase, { winner: latestRaceState.winner, countdown: latestRaceState.countdown });
          (hud as RaceHud).setProgress(latestRaceState.laps, latestRaceState.places);
          (hud as RaceHud).setSpeed(latestRaceState.cars[1].speed);
          updateArenaCamera(rig.camera, raceView.carPositions());
        } else if (latestDerbyState) {
          if (!derbyView) {
            derbyView = new ClientView(rig.scene, INITIAL_RADIUS);
            hud = new Hud(app, ['GEGNER (HOST)', 'DU']);
          }
          derbyView.applyState(latestDerbyState, dt);
          (hud as Hud).setPhase(latestDerbyState.phase, { winner: latestDerbyState.winner, countdown: latestDerbyState.countdown });
          const hp: [number, number] = [latestDerbyState.cars[0].hp, latestDerbyState.cars[1].hp];
          (hud as Hud).setHp(hp, MAX_HP);
          (hud as Hud).setScore(latestDerbyState.score);
          (hud as Hud).setSpeed(latestDerbyState.cars[1].speed);
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

showMenu();
