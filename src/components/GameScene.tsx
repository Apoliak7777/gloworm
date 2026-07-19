import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, globalGameState } from '../store/gameStore';
import { POINTER_DEAD_ZONE_PX, inputMode, pointerSteering, usePlayerInputs } from '../hooks/usePlayerInputs';
import {
  checkOrbCollision,
  checkOtherPlayerCollisions,
  checkSelfCollision,
  createLocalPlayerState,
  initPathFromSegments,
  smoothing,
  stepLocalPlayer,
} from '../shared/gameLogic';
import { localPlayerView, resetLocalPlayerView } from '../store/localPlayerView';
import { GameState, MIN_SCORE } from '../shared/types';
import { Arena } from './Arena';
import { Starfield } from './Starfield';
import { Snake } from './Snake';
import { Orbs, localCollectedOrbs } from './Orbs';
import { Burst, DeathBurst } from './DeathBurst';
import { playDeath, playOrbPickup } from '../utils/sfx';

let burstId = 0;

/** Camera smoothing rates (higher = snappier follow). */
const CAMERA_FOLLOW_RATE = 9;
const CAMERA_ZOOM_RATE = 3;
/** Screen shake: trauma decays per second; shake = trauma^2 * SHAKE_MAX. */
const TRAUMA_DECAY = 2.2;
const SHAKE_MAX = 1.2;

// Separators that sanitizePlayerName() strips, so they can't appear in a name.
const FIELD_SEP = '\u0001';
const ENTRY_SEP = '\u0002';

/**
 * A stable string describing *which* snakes should be rendered. Subscribing to
 * this instead of the whole store means React only re-renders the scene when a
 * snake joins, dies or respawns — not 12.5 times a second as positions update.
 * Positions are read live from globalGameState inside useFrame.
 */
function rosterKey(gs: GameState): string {
  let key = '';
  for (const id in gs.players) {
    const p = gs.players[id];
    if (p.state !== 'alive' || !p.segments?.length) continue;
    key += `${id}${FIELD_SEP}${p.color}${FIELD_SEP}${p.name}${ENTRY_SEP}`;
  }
  return key;
}

function parseRoster(key: string): Array<{ id: string; color: string; name: string }> {
  return key
    .split(ENTRY_SEP)
    .filter(Boolean)
    .map((entry) => {
      const [id, color, name] = entry.split(FIELD_SEP);
      return { id, color, name };
    });
}

export function GameScene() {
  // Subscribe narrowly: the frame loop reads live data from globalGameState, so
  // this component only needs to re-render when the player id or the set of
  // rendered snakes actually changes — not on every 12.5 Hz store write.
  const playerId = useGameStore((s) => s.playerId);
  const snakeRoster = useGameStore(
    (s) => (s.gameState ? rosterKey(s.gameState) : ''),
  );
  const { sendPlayerState, sendCollectOrb, recordDeath } = useGameStore.getState();
  const { camera, size } = useThree();
  const inputs = usePlayerInputs();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const [lightTarget] = useState(() => new THREE.Object3D());
  const localPlayer = useRef(createLocalPlayerState());
  const [bursts, setBursts] = useState<Burst[]>([]);
  const prevAlive = useRef(new Map<string, { x: number; y: number; color: string }>());
  // True from the moment we detect our own death until the server confirms it.
  // Stops the death-detection loop from re-activating us off stale server state
  // (which caused duplicate deaths, doubled SFX/bursts, and a lost "new best").
  const pendingDeath = useRef(false);
  /** Screen-shake trauma (0..1) and the offset it applied last frame. */
  const trauma = useRef(0);
  const shakeOffset = useRef({ x: 0, y: 0 });

  const decayShake = (delta: number) => {
    if (trauma.current > 0) {
      trauma.current = Math.max(0, trauma.current - TRAUMA_DECAY * delta);
      if (trauma.current === 0) {
        shakeOffset.current.x = 0;
        shakeOffset.current.y = 0;
      }
    }
  };
  // orbId -> when it was optimistically collected + the score we added, so we
  // can un-hide it and refund the score if the server never removes it.
  const collectedAt = useRef(new Map<string, { t: number; value: number }>());

  useEffect(() => {
    return () => {
      localCollectedOrbs.clear();
      collectedAt.current.clear();
      pendingDeath.current = false;
      resetLocalPlayerView();
      localPlayer.current = createLocalPlayerState();
    };
  }, [playerId]);

  const addBurst = (x: number, y: number, color: string) => {
    setBursts((prev) => [...prev.slice(-7), { id: burstId++, x, y, color }]);
  };

  const removeBurst = (id: number) => {
    setBursts((prev) => prev.filter((b) => b.id !== id));
  };

  useFrame((state, delta) => {
    const gs = globalGameState.current;
    if (!gs || !playerId) return;

    // Show a particle burst wherever any snake stopped being alive.
    for (const [id, info] of prevAlive.current) {
      const now = gs.players[id];
      if (!now || now.state !== 'alive') {
        addBurst(info.x, info.y, info.color);
        prevAlive.current.delete(id);
        // Only a very close death nudges the camera. Bots die regularly, and
        // shaking for each one turns into constant camera noise.
        const localHead = localPlayer.current.segments[0];
        if (localHead) {
          const dist = Math.hypot(info.x - localHead.x, info.y - localHead.y);
          if (dist < 16) trauma.current = Math.min(0.35, trauma.current + 0.2 * (1 - dist / 16));
        }
      }
    }
    for (const id in gs.players) {
      const p = gs.players[id];
      // Skip the local player once its simulation stopped — die() already
      // spawned the burst; the server just hasn't caught up yet.
      if (id === playerId && !localPlayer.current.active) continue;
      if (p.state === 'alive' && p.segments[0]) {
        prevAlive.current.set(id, { x: p.segments[0].x, y: p.segments[0].y, color: p.color });
      }
    }

    const serverPlayer = gs.players[playerId];
    if (!serverPlayer || serverPlayer.state !== 'alive') {
      // The server has now reflected our death, so it is safe to accept a
      // future fresh spawn again.
      localPlayer.current.active = false;
      localPlayerView.active = false;
      pendingDeath.current = false;
      // Keep decaying the shake while the death screen is up. If this is
      // skipped, trauma stays pinned at 1 and the *next* spawn starts with a
      // full-strength camera shake exactly as the player takes control.
      decayShake(delta);
      return;
    }

    // Only (re)activate from genuinely fresh server state — never while a death
    // is still in flight, or we would resurrect off the pre-death snapshot.
    if (!localPlayer.current.active && !pendingDeath.current && serverPlayer.segments.length > 0) {
      localPlayer.current = {
        ...createLocalPlayerState(),
        active: true,
        segments: serverPlayer.segments.map((s) => ({ ...s })),
        score: serverPlayer.score,
        currentAngle: serverPlayer.currentAngle,
      };
      initPathFromSegments(localPlayer.current, serverPlayer.segments);
      // Take control on a perfectly steady camera.
      trauma.current = 0;
      shakeOffset.current.x = 0;
      shakeOffset.current.y = 0;
      camera.position.set(serverPlayer.segments[0].x, serverPlayer.segments[0].y, camera.position.z);
    }

    if (!localPlayer.current.active) {
      decayShake(delta);
      return;
    }

    const die = (head: { x: number; y: number }, killedBy?: string) => {
      localPlayer.current.active = false;
      localPlayerView.active = false;
      pendingDeath.current = true;
      prevAlive.current.delete(playerId);
      const finalScore = localPlayer.current.score;
      const rank =
        1 +
        Object.values(gs.players).filter(
          (p) => p.id !== playerId && p.state === 'alive' && p.score > finalScore,
        ).length;
      recordDeath(finalScore, rank);
      playDeath();
      trauma.current = 1;
      addBurst(head.x, head.y, serverPlayer.color);
      sendPlayerState({
        segments: localPlayer.current.segments,
        score: finalScore,
        currentAngle: localPlayer.current.currentAngle,
        isBoosting: false,
        state: 'dead',
        killedBy,
      });
    };

    // Pointer steering measured from the SCREEN CENTRE — a fixed reference.
    // Deriving it from the head's projected position instead creates a feedback
    // loop (turning moves the camera, which moves the head on screen, which
    // changes the angle, which turns the snake) and makes "point at the middle"
    // mean an arbitrary heading. The camera keeps the head centred so this
    // reference and the snake coincide.
    if (inputMode === 'pointer' && pointerSteering.active) {
      const dx = pointerSteering.x - size.width / 2;
      const dy = pointerSteering.y - size.height / 2;
      // Inside the dead zone, hold the current heading rather than chasing a
      // noisy near-zero vector.
      if (dx * dx + dy * dy > POINTER_DEAD_ZONE_PX * POINTER_DEAD_ZONE_PX) {
        inputs.current.targetAngle = Math.atan2(-dy, dx);
      } else {
        inputs.current.targetAngle = null;
      }
    }

    const { head, died: boundaryDeath } = stepLocalPlayer(localPlayer.current, inputs.current, delta);

    if (boundaryDeath) {
      die(head);
      return;
    }

    const nowMs = performance.now();
    for (const orbId in gs.orbs) {
      if (localCollectedOrbs.has(orbId)) continue;
      const orb = gs.orbs[orbId];
      if (checkOrbCollision(head, orb.x, orb.y)) {
        localPlayer.current.score += orb.value;
        // Hide it optimistically via localCollectedOrbs rather than deleting it
        // from the map: orbs now arrive as deltas, so a locally deleted orb
        // would never come back if the server rejects the pickup.
        localCollectedOrbs.add(orbId);
        collectedAt.current.set(orbId, { t: nowMs, value: orb.value });
        sendCollectOrb(orbId);
        playOrbPickup();
      }
    }

    // Reconcile optimistic pickups with the server. If an orb is still present
    // after a short grace period the server rejected our collection, so restore
    // it (visible + collectable again) and revert the optimistic score.
    for (const [id, info] of collectedAt.current) {
      if (!gs.orbs[id]) {
        collectedAt.current.delete(id);
        localCollectedOrbs.delete(id);
      } else if (nowMs - info.t > 150) {
        collectedAt.current.delete(id);
        localCollectedOrbs.delete(id);
        localPlayer.current.score = Math.max(MIN_SCORE, localPlayer.current.score - info.value);
      }
    }

    const selfHit = checkSelfCollision(head, localPlayer.current.segments);
    const killerId = checkOtherPlayerCollisions(head, playerId, gs.players);

    if (selfHit || killerId) {
      die(head, killerId ?? undefined);
      return;
    }

    gs.players[playerId].segments = localPlayer.current.segments;
    gs.players[playerId].score = localPlayer.current.score;
    gs.players[playerId].currentAngle = localPlayer.current.currentAngle;
    gs.players[playerId].isBoosting = localPlayer.current.isBoosting;

    // Publish the freshly simulated pose for Snake to render from, bypassing
    // the lagged/rounded server snapshot entirely.
    localPlayerView.active = true;
    localPlayerView.segments = localPlayer.current.segments;
    localPlayerView.angle = localPlayer.current.currentAngle;
    localPlayerView.isBoosting = localPlayer.current.isBoosting;

    const now = Date.now();
    if (now - localPlayer.current.lastSendTime > 50) {
      sendPlayerState({
        segments: localPlayer.current.segments,
        score: localPlayer.current.score,
        currentAngle: localPlayer.current.currentAngle,
        isBoosting: localPlayer.current.isBoosting,
        state: 'alive',
      });
      localPlayer.current.lastSendTime = now;
    }

    // Exponential smoothing: frame-rate independent and can never overshoot,
    // even on a huge delta after returning to a backgrounded tab.
    const followT = smoothing(CAMERA_FOLLOW_RATE, delta);
    const zoomT = smoothing(CAMERA_ZOOM_RATE, delta);
    const targetZ = Math.min(62, Math.max(30, 30 + localPlayer.current.score * 0.16));

    // The camera stays locked on the head. A "lead" offset was tried and
    // removed: it puts the snake off-centre, which breaks the mouse-steering
    // reference and makes aiming feel wrong for a marginal cosmetic gain.
    // Undo the previous frame's shake before smoothing, so the offset is never
    // fed back into the follow filter (that turns it into a random walk).
    camera.position.x -= shakeOffset.current.x;
    camera.position.y -= shakeOffset.current.y;

    camera.position.x += (head.x - camera.position.x) * followT;
    camera.position.y += (head.y - camera.position.y) * followT;
    camera.position.z += (targetZ - camera.position.z) * zoomT;
    // Aim at the unshaken point so shake never drags the view off target.
    camera.lookAt(camera.position.x, camera.position.y, 0);

    decayShake(delta);
    // Two fixed-frequency sinusoids instead of per-frame randomness: white
    // noise on the camera is perceptually indistinguishable from dropped frames.
    if (trauma.current > 0) {
      const amount = trauma.current * trauma.current * SHAKE_MAX;
      const t = state.clock.elapsedTime;
      shakeOffset.current.x = Math.sin(t * 62) * amount;
      shakeOffset.current.y = Math.cos(t * 41) * amount;
      camera.position.x += shakeOffset.current.x;
      camera.position.y += shakeOffset.current.y;
    }

    if (lightRef.current) {
      lightRef.current.position.set(camera.position.x + 12, camera.position.y - 12, 35);
      lightTarget.position.set(camera.position.x, camera.position.y, 0);
    }
    // Priority -1: React registers child effects before parent ones, so without
    // this the Snake components would draw *last* frame's simulated position
    // while the camera moved to this frame's — the snake visibly slides against
    // the background. Negative priorities don't disable R3F's auto-render.
  }, -1);

  if (!snakeRoster) return null;

  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight
        ref={lightRef}
        target={lightTarget}
        castShadow
        intensity={2.2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={0.1}
        shadow-camera-far={120}
        shadow-bias={-0.001}
      />
      <primitive object={lightTarget} />

      <Starfield />
      <Arena />
      <Orbs />

      {bursts.map((burst) => (
        <DeathBurst key={burst.id} burst={burst} onDone={removeBurst} />
      ))}

      {parseRoster(snakeRoster).map((snake) => (
        <Snake
          key={snake.id}
          playerId={snake.id}
          color={snake.color}
          name={snake.name}
          isLocal={snake.id === playerId}
        />
      ))}
    </>
  );
}
