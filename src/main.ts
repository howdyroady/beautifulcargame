import './style.css';
import { createSceneRig, updateArenaCamera } from './sceneSetup';
import { Match } from './game/matchState';
import { MAX_HP } from './game/carEntity';
import { KeyboardInputSource, NEUTRAL_INPUT, type CarInput } from './input/input';
import { Hud } from './ui/hud';
import { MainMenu, LobbyScreen } from './ui/menus';
import { NetSession } from './net/peer';
import { ClientView } from './net/clientView';
import { INITIAL_RADIUS } from './arena/arena';
import type { StateMessage } from './net/protocol';

const app = document.getElementById('app')!;
const rig = createSceneRig(app);

let frameHandle = 0;
function stopLoop() {
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = 0;
}

function clearScene() {
  while (rig.scene.children.length) rig.scene.remove(rig.scene.children[0]);
}

function showMenu() {
  stopLoop();
  clearScene();
  rig.camera.position.set(0, 16, 20);
  const menu = new MainMenu(app, {
    onLocal: () => {
      menu.destroy();
      startLocalMatch();
    },
    onHost: () => {
      menu.destroy();
      startHost();
    },
    onJoin: (code) => {
      menu.destroy();
      startJoin(code);
    },
  });
}

function startLocalMatch() {
  clearScene();
  const hud = new Hud(app, ['SPIELER 1', 'SPIELER 2']);
  const match = new Match(rig.scene, {
    onPhaseChange: (phase, data) => hud.setPhase(phase, data),
    onHpChange: (hp) => hud.setHp(hp, MAX_HP),
    onScoreChange: (score) => hud.setScore(score),
  });
  const inputA = new KeyboardInputSource('wasd');
  const inputB = new KeyboardInputSource('arrows');

  let matchEndedAt = 0;
  let last = performance.now();
  function loop(now: number) {
    frameHandle = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    match.update(dt, inputA.read(), inputB.read());
    if (match.phase === 'matchEnd') {
      if (!matchEndedAt) matchEndedAt = now;
      if (now - matchEndedAt > 4000) {
        matchEndedAt = 0;
        match.resetMatch();
      }
    }

    updateArenaCamera(rig.camera, match.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
    rig.renderer.render(rig.scene, rig.camera);
  }
  frameHandle = requestAnimationFrame(loop);
}

function startHost() {
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
      const hud = new Hud(app, ['DU (HOST)', 'GEGNER']);
      const match = new Match(rig.scene, {
        onPhaseChange: (phase, data) => hud.setPhase(phase, data),
        onHpChange: (hp) => hud.setHp(hp, MAX_HP),
        onScoreChange: (score) => hud.setScore(score),
      });
      const inputA = new KeyboardInputSource('wasd');

      let sendAccumulator = 0;
      let matchEndedAt = 0;
      let last = performance.now();
      function loop(now: number) {
        frameHandle = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        match.update(dt, inputA.read(), remoteInput);
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

        updateArenaCamera(rig.camera, match.cars.map((c) => ({ x: c.body.position.x, z: c.body.position.z })));
        rig.renderer.render(rig.scene, rig.camera);
      }
      frameHandle = requestAnimationFrame(loop);
    },
  });

  session.host().then((code) => {
    lobby.setCode(code);
  });
}

function startJoin(code: string) {
  clearScene();
  const lobby = new LobbyScreen(app, () => {
    lobby.destroy();
    showMenu();
  });

  let latestState: StateMessage | null = null;
  const session = new NetSession({
    onStatus: (text) => lobby.setStatus(text),
    onConnected: () => {
      lobby.destroy();
      clearScene();
      const hud = new Hud(app, ['GEGNER (HOST)', 'DU']);
      const view = new ClientView(rig.scene, INITIAL_RADIUS);
      const input = new KeyboardInputSource('wasd');

      let sendAccumulator = 0;
      let last = performance.now();
      function loop(now: number) {
        frameHandle = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        sendAccumulator += dt;
        if (sendAccumulator >= 1 / 25) {
          sendAccumulator = 0;
          session.send({ t: 'input', input: input.read() });
        }

        if (latestState) {
          view.applyState(latestState, dt);
          hud.setPhase(latestState.phase, { winner: latestState.winner, countdown: latestState.countdown });
          hud.setHp([latestState.cars[0].hp, latestState.cars[1].hp], MAX_HP);
          hud.setScore(latestState.score);
          updateArenaCamera(rig.camera, view.carPositions());
        }
        rig.renderer.render(rig.scene, rig.camera);
      }
      frameHandle = requestAnimationFrame(loop);
    },
    onData: (data) => {
      const msg = data as StateMessage;
      if (msg.t === 'state') latestState = msg;
    },
    onDisconnected: () => lobby.setStatus('Verbindung getrennt.'),
  });

  session.join(code).catch(() => {
    lobby.setStatus('Konnte nicht beitreten. Code prüfen und erneut versuchen.');
  });
}

showMenu();
