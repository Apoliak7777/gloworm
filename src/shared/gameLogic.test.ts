import { describe, expect, it } from 'vitest';
import {
  InputState,
  checkOtherPlayerCollisions,
  checkSelfCollision,
  clamp,
  createLocalPlayerState,
  initPathFromSegments,
  isOutOfBounds,
  sanitizePlayerName,
  segmentsFromPath,
  shortestArc,
  smoothing,
  spawnSegments,
  stepLocalPlayer,
} from './gameLogic';
import {
  ARENA_RADIUS,
  BASE_SPEED,
  INITIAL_LENGTH,
  MIN_SCORE,
  SEGMENT_SPACING,
  SELF_COLLISION_ENABLED,
  SELF_COLLISION_SKIP,
  TURN_ACCEL,
  TURN_SETTLE_TIME,
  TURN_SPEED,
} from './types';

function makePlayer(startAngle = 0, score = 40) {
  const p = createLocalPlayerState();
  const segs = spawnSegments(0, 0, startAngle, INITIAL_LENGTH);
  p.active = true;
  p.segments = segs.map((s) => ({ ...s }));
  p.score = score;
  p.currentAngle = startAngle;
  initPathFromSegments(p, segs);
  return p;
}

const steer = (targetAngle: number | null): InputState => ({ targetAngle, turn: 0, boost: false });
const idle: InputState = { targetAngle: null, turn: 0, boost: false };

describe('segmentsFromPath', () => {
  it('spaces segments exactly SEGMENT_SPACING apart', () => {
    const path = Array.from({ length: 200 }, (_, i) => ({ x: -i * 0.07, y: 0 }));
    const segs = segmentsFromPath(path, 30);
    expect(segs).toHaveLength(30);
    for (let i = 1; i < segs.length; i++) {
      const gap = Math.hypot(segs[i].x - segs[i - 1].x, segs[i].y - segs[i - 1].y);
      expect(gap).toBeCloseTo(SEGMENT_SPACING, 6);
    }
  });

  it('extends the tail when the path is shorter than the snake', () => {
    const segs = segmentsFromPath([{ x: 0, y: 0 }, { x: -0.5, y: 0 }], 10);
    expect(segs).toHaveLength(10);
    for (let i = 1; i < segs.length; i++) {
      const gap = Math.hypot(segs[i].x - segs[i - 1].x, segs[i].y - segs[i - 1].y);
      expect(gap).toBeCloseTo(SEGMENT_SPACING, 6);
    }
  });

  it('returns nothing for an empty path or non-positive count', () => {
    expect(segmentsFromPath([], 10)).toEqual([]);
    expect(segmentsFromPath([{ x: 0, y: 0 }], 0)).toEqual([]);
  });
});

describe('frame-rate independence', () => {
  // The README claims movement is identical at 30 and 144 FPS — verify it.
  const simulate = (fps: number, seconds: number, target: number) => {
    const p = makePlayer(0);
    const dt = 1 / fps;
    for (let t = 0; t < seconds; t += dt) stepLocalPlayer(p, steer(target), dt);
    return p;
  };

  it('reaches the same heading at 30, 60 and 144 FPS', () => {
    const a = simulate(30, 2, Math.PI / 4);
    const b = simulate(60, 2, Math.PI / 4);
    const c = simulate(144, 2, Math.PI / 4);
    expect(shortestArc(a.currentAngle)).toBeCloseTo(Math.PI / 4, 4);
    expect(shortestArc(b.currentAngle)).toBeCloseTo(Math.PI / 4, 4);
    expect(shortestArc(c.currentAngle)).toBeCloseTo(Math.PI / 4, 4);
  });

  it('produces the same snake length regardless of frame rate', () => {
    expect(simulate(30, 2, Math.PI / 4).segments.length).toBe(
      simulate(144, 2, Math.PI / 4).segments.length,
    );
  });

  it('clamps a huge delta so a backgrounded tab cannot teleport the snake', () => {
    const p = makePlayer(0);
    const before = p.segments[0].x;
    stepLocalPlayer(p, idle, 5);
    // MAX_FRAME_DELTA (0.1s) * BASE_SPEED (18) = 1.8 units, not 90.
    expect(p.segments[0].x - before).toBeLessThanOrEqual(1.81);
  });
});

describe('steering dynamics', () => {
  it('is critically damped, so held turns never overshoot', () => {
    // The invariant documented in types.ts: damping ratio >= 1.
    expect(Math.sqrt(TURN_ACCEL * TURN_SETTLE_TIME) / 2).toBeGreaterThanOrEqual(1);

    for (const targetDeg of [30, 45, 90, 135, 180]) {
      const target = (targetDeg * Math.PI) / 180;
      const p = makePlayer(0);
      let peak = -Infinity;
      for (let i = 0; i < 400; i++) {
        stepLocalPlayer(p, steer(target), 1 / 60);
        let h = (shortestArc(p.currentAngle) * 180) / Math.PI;
        if (h < -1) h += 360;
        peak = Math.max(peak, h);
      }
      expect(peak).toBeLessThanOrEqual(targetDeg + 0.01);
    }
  });

  it('eases angular velocity in rather than snapping to full rate', () => {
    // A hard 180 asks for maximum turn rate, so this is the strongest possible
    // demand: velocity must still ramp across frames instead of jumping to cap.
    const p = makePlayer(0);
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) {
      stepLocalPlayer(p, steer(Math.PI), 1 / 60);
      samples.push(Math.abs(p.angularVelocity));
    }
    // Strictly increasing, and still short of the cap after four frames.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    // The invariant is that velocity ramps rather than being applied instantly;
    // the exact fraction is a tuning choice, so only assert it is short of cap.
    expect(samples[0]).toBeLessThan(TURN_SPEED * 0.85);
    expect(samples[samples.length - 1]).toBeLessThan(TURN_SPEED);
  });

  it('decays angular velocity to zero when input is released', () => {
    const p = makePlayer(0);
    for (let i = 0; i < 10; i++) stepLocalPlayer(p, steer(Math.PI / 2), 1 / 60);
    expect(Math.abs(p.angularVelocity)).toBeGreaterThan(0.5);
    for (let i = 0; i < 120; i++) stepLocalPlayer(p, idle, 1 / 60);
    expect(Math.abs(p.angularVelocity)).toBeLessThan(0.01);
  });

  it('keeps going straight with no input', () => {
    const p = makePlayer(0.7);
    for (let i = 0; i < 60; i++) stepLocalPlayer(p, idle, 1 / 60);
    expect(p.currentAngle).toBeCloseTo(0.7, 6);
  });
});

describe('hold-to-rotate steering', () => {
  const holdTurn = (turn: number): InputState => ({ targetAngle: null, turn, boost: false });

  it('rotates continuously while a direction is held', () => {
    const p = makePlayer(0);
    for (let i = 0; i < 30; i++) stepLocalPlayer(p, holdTurn(-1), 1 / 60); // settle
    const before = p.currentAngle;
    for (let i = 0; i < 60; i++) stepLocalPlayer(p, holdTurn(-1), 1 / 60);
    const rate = Math.abs(p.currentAngle - before);
    expect(rate).toBeCloseTo(TURN_SPEED, 1);
  });

  it('eases into the turn instead of snapping to full rate', () => {
    const p = makePlayer(0);
    const samples: number[] = [];
    for (let i = 0; i < 4; i++) {
      stepLocalPlayer(p, holdTurn(-1), 1 / 60);
      samples.push(Math.abs(p.angularVelocity));
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
    expect(samples[0]).toBeLessThan(TURN_SPEED);
  });

  it('coasts out of the turn when released', () => {
    const p = makePlayer(0);
    for (let i = 0; i < 30; i++) stepLocalPlayer(p, holdTurn(-1), 1 / 60);
    const atRelease = Math.abs(p.angularVelocity);
    stepLocalPlayer(p, holdTurn(0), 1 / 60);
    const justAfter = Math.abs(p.angularVelocity);
    expect(justAfter).toBeLessThan(atRelease);
    expect(justAfter).toBeGreaterThan(0); // not a hard stop
    for (let i = 0; i < 120; i++) stepLocalPlayer(p, holdTurn(0), 1 / 60);
    expect(Math.abs(p.angularVelocity)).toBeLessThan(0.01);
  });

  it('holds a heading when both directions are pressed', () => {
    const p = makePlayer(0.4);
    for (let i = 0; i < 60; i++) stepLocalPlayer(p, holdTurn(0), 1 / 60);
    expect(p.currentAngle).toBeCloseTo(0.4, 6);
  });

  it('turns at the same rate regardless of frame rate', () => {
    const run = (fps: number) => {
      const p = makePlayer(0);
      for (let t = 0; t < 1.5; t += 1 / fps) stepLocalPlayer(p, holdTurn(-1), 1 / fps);
      return p.currentAngle;
    };
    expect(run(30)).toBeCloseTo(run(144), 1);
  });

  it('keeps a held full circle clear of the snake body', () => {
    // The turn radius must be large enough that holding a turn is survivable.
    const radius = BASE_SPEED / TURN_SPEED;
    expect(radius).toBeGreaterThan(3.5);
  });
});

describe('boost', () => {
  it('drains score but never below MIN_SCORE', () => {
    const p = makePlayer(0, MIN_SCORE + 3);
    for (let i = 0; i < 600; i++) {
      stepLocalPlayer(p, { targetAngle: null, turn: 0, boost: true }, 1 / 60);
    }
    expect(p.score).toBeGreaterThanOrEqual(MIN_SCORE);
  });

  it('refuses to boost when there is nothing to spend', () => {
    const p = makePlayer(0, MIN_SCORE);
    stepLocalPlayer(p, { targetAngle: null, turn: 0, boost: true }, 1 / 60);
    expect(p.isBoosting).toBe(false);
  });
});

describe('bounds', () => {
  it('treats the arena as a circle, not a square', () => {
    expect(isOutOfBounds(ARENA_RADIUS - 1, 0)).toBe(false);
    // A square boundary would wrongly allow this diagonal corner.
    expect(isOutOfBounds(ARENA_RADIUS * 0.9, ARENA_RADIUS * 0.9)).toBe(true);
  });

  it('reports death when driving into the wall', () => {
    const p = makePlayer(0, 12);
    p.segments = spawnSegments(ARENA_RADIUS - 2, 0, 0, 12);
    initPathFromSegments(p, p.segments);
    let died = false;
    for (let i = 0; i < 600 && !died; i++) died = stepLocalPlayer(p, idle, 1 / 60).died;
    expect(died).toBe(true);
  });
});

describe('collisions', () => {
  it('does not kill you on your own body (slither-style, so held turns are safe)', () => {
    const segs = spawnSegments(0, 0, 0, 30);
    segs[20] = { x: segs[0].x, y: segs[0].y };
    expect(SELF_COLLISION_ENABLED).toBe(false);
    expect(checkSelfCollision(segs[0], segs)).toBe(false);
  });

  it('still ignores the neck, so enabling classic rules would not insta-kill', () => {
    // The head always overlaps its immediate neighbours; the skip exists so
    // classic-snake rules remain playable if SELF_COLLISION_ENABLED is flipped.
    expect(SELF_COLLISION_SKIP).toBeGreaterThan(1);
    const segs = spawnSegments(0, 0, 0, 30);
    let neckHit = false;
    for (let i = 1; i < SELF_COLLISION_SKIP; i++) {
      if (Math.hypot(segs[i].x - segs[0].x, segs[i].y - segs[0].y) < 1.25) neckHit = true;
    }
    expect(neckHit).toBe(true);
  });

  it('returns the id of the snake that was hit, for kill attribution', () => {
    const players = {
      victim: { state: 'alive', segments: [{ x: 0, y: 0 }] },
      killer: { state: 'alive', segments: [{ x: 0.2, y: 0 }, { x: 0.7, y: 0 }] },
    };
    expect(checkOtherPlayerCollisions({ x: 0, y: 0 }, 'victim', players)).toBe('killer');
  });

  it('ignores dead snakes and far-away snakes', () => {
    const players = {
      me: { state: 'alive', segments: [{ x: 0, y: 0 }] },
      corpse: { state: 'dead', segments: [{ x: 0, y: 0 }] },
      distant: { state: 'alive', segments: [{ x: 500, y: 500 }] },
    };
    expect(checkOtherPlayerCollisions({ x: 0, y: 0 }, 'me', players)).toBeNull();
  });
});

describe('helpers', () => {
  it('normalizes angles to the shortest arc', () => {
    expect(shortestArc(0.5)).toBeCloseTo(0.5, 6);
    expect(shortestArc(2 * Math.PI + 0.5)).toBeCloseTo(0.5, 6);
    expect(shortestArc(-2 * Math.PI - 0.5)).toBeCloseTo(-0.5, 6);
    // +-PI are the same heading, so only the magnitude is meaningful there.
    expect(Math.abs(shortestArc(3 * Math.PI))).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(shortestArc(-3 * Math.PI))).toBeCloseTo(Math.PI, 6);
    // Always within [-PI, PI].
    for (const a of [-20, -7, -1, 0, 1, 7, 20]) {
      expect(Math.abs(shortestArc(a))).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it('smoothing is frame-rate independent over the same wall-clock time', () => {
    // Applying the factor twice at dt should equal once at 2*dt.
    const once = smoothing(10, 0.2);
    const twiceRemaining = (1 - smoothing(10, 0.1)) * (1 - smoothing(10, 0.1));
    expect(1 - twiceRemaining).toBeCloseTo(once, 10);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(1, 0, 3)).toBe(1);
  });
});

describe('sanitizePlayerName', () => {
  it('trims and caps length', () => {
    expect(sanitizePlayerName('  Alex  ')).toBe('Alex');
    expect(sanitizePlayerName('x'.repeat(40))).toHaveLength(16);
  });

  it('falls back for empty or too-short names', () => {
    expect(sanitizePlayerName('')).toMatch(/^Snake-\d{4}$/);
    expect(sanitizePlayerName('a')).toMatch(/^Snake-\d{4}$/);
    expect(sanitizePlayerName(undefined)).toMatch(/^Snake-\d{4}$/);
  });

  it('strips control characters that would corrupt the UI', () => {
    expect(sanitizePlayerName('ab cd')).toBe('abcd');
  });

  it('keeps emoji intact (surrogate pairs must survive)', () => {
    expect(sanitizePlayerName('hi🐍there')).toBe('hi🐍there');
  });
});
