import {
  ARENA_RADIUS,
  BASE_SPEED,
  BOOST_COST_PER_SEC,
  BOOST_SPEED,
  COLLISION_RADIUS,
  MAX_FRAME_DELTA,
  MIN_SCORE,
  ORB_COLLECT_RADIUS,
  SELF_COLLISION_ENABLED,
  SELF_COLLISION_SKIP,
  SEGMENT_SPACING,
  Segment,
  TURN_ACCEL,
  TURN_SETTLE_TIME,
  TURN_SPEED,
} from './types';

export type InputState = {
  /** Absolute heading (radians) to steer toward, or null to keep going straight. */
  targetAngle: number | null;
  /** Relative turn from touch buttons: +1 = left (CCW), -1 = right (CW), 0 = none. */
  turn: number;
  boost: boolean;
};

export type LocalPlayerState = {
  active: boolean;
  segments: Segment[];
  /** Head position history (most recent first) used to place segments at fixed spacing. */
  path: Segment[];
  score: number;
  currentAngle: number;
  /** Current turn rate (rad/s); eased toward the desired rate for smooth arcs. */
  angularVelocity: number;
  isBoosting: boolean;
  lastSendTime: number;
};

export function createLocalPlayerState(): LocalPlayerState {
  return {
    active: false,
    segments: [],
    path: [],
    score: MIN_SCORE,
    currentAngle: 0,
    angularVelocity: 0,
    isBoosting: false,
    lastSendTime: 0,
  };
}

/** Frame-rate-independent exponential smoothing factor for a given rate. */
export function smoothing(rate: number, delta: number): number {
  return 1 - Math.exp(-rate * delta);
}

/** Normalizes an angle difference to the shortest signed arc in [-PI, PI]. */
export function shortestArc(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isOutOfBounds(x: number, y: number): boolean {
  // Radial test so the death boundary matches the circular arena wall.
  return x * x + y * y > ARENA_RADIUS * ARENA_RADIUS;
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function checkOrbCollision(head: Segment, orbX: number, orbY: number): boolean {
  return distanceSq(head.x, head.y, orbX, orbY) < ORB_COLLECT_RADIUS * ORB_COLLECT_RADIUS;
}

export function checkSegmentCollision(head: Segment, segment: Segment): boolean {
  return distanceSq(head.x, head.y, segment.x, segment.y) < COLLISION_RADIUS * COLLISION_RADIUS;
}

export function checkSelfCollision(head: Segment, segments: Segment[]): boolean {
  if (!SELF_COLLISION_ENABLED) return false;
  for (let i = SELF_COLLISION_SKIP; i < segments.length; i++) {
    if (checkSegmentCollision(head, segments[i])) return true;
  }
  return false;
}

/**
 * Returns the id of the snake this head ran into, or null. Returning the id
 * (rather than a boolean) is what lets the game attribute kills.
 */
export function checkOtherPlayerCollisions(
  head: Segment,
  playerId: string,
  players: Record<string, { state: string; segments: Segment[] }>,
): string | null {
  for (const otherId in players) {
    if (otherId === playerId) continue;
    const other = players[otherId];
    if (other.state !== 'alive' || !other.segments?.length) continue;

    // Broad phase: a snake's body trails back from its head, so if the head is
    // further than the body could possibly reach, skip all of its segments.
    const otherHead = other.segments[0];
    const reach = other.segments.length * SEGMENT_SPACING + COLLISION_RADIUS + 1;
    const dx = otherHead.x - head.x;
    const dy = otherHead.y - head.y;
    if (dx * dx + dy * dy > reach * reach) continue;

    for (const segment of other.segments) {
      if (checkSegmentCollision(head, segment)) return otherId;
    }
  }
  return null;
}

/**
 * Places `count` segments along the recorded head path, one every
 * SEGMENT_SPACING world units. Snake length is therefore identical on a
 * 30 Hz laptop and a 144 Hz gaming rig — the frame rate only affects how
 * densely the raw path is sampled, not where segments end up.
 */
export function segmentsFromPath(path: Segment[], count: number): Segment[] {
  const segments: Segment[] = [];
  if (path.length === 0 || count <= 0) return segments;

  segments.push({ x: path[0].x, y: path[0].y });
  let target = SEGMENT_SPACING;
  let traveled = 0;

  for (let i = 1; i < path.length && segments.length < count; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const stepLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (stepLen === 0) continue;

    while (traveled + stepLen >= target && segments.length < count) {
      const t = (target - traveled) / stepLen;
      segments.push({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
      });
      target += SEGMENT_SPACING;
    }
    traveled += stepLen;
  }

  // Freshly spawned snakes have a shorter path than their length; extend the
  // tail in a straight line so the snake starts at full size.
  while (segments.length < count) {
    const last = segments[segments.length - 1];
    const prev = segments.length > 1 ? segments[segments.length - 2] : null;
    let dx = -1;
    let dy = 0;
    if (prev) {
      const len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
      dx = (last.x - prev.x) / len;
      dy = (last.y - prev.y) / len;
    }
    segments.push({ x: last.x + dx * SEGMENT_SPACING, y: last.y + dy * SEGMENT_SPACING });
  }

  return segments;
}

/** Drops path points that are further back than the snake needs. */
function prunePath(path: Segment[], neededLength: number): void {
  let traveled = 0;
  for (let i = 1; i < path.length; i++) {
    traveled += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (traveled > neededLength) {
      path.length = i + 1;
      return;
    }
  }
}

/** Seeds the path from server-provided segments (they are already evenly spaced). */
export function initPathFromSegments(player: LocalPlayerState, segments: Segment[]): void {
  player.path = segments.map((s) => ({ ...s }));
}

export function stepLocalPlayer(
  player: LocalPlayerState,
  inputs: InputState,
  rawDelta: number,
): { head: Segment; died: boolean } {
  const delta = Math.min(rawDelta, MAX_FRAME_DELTA);

  // --- Steering -----------------------------------------------------------
  // The snake never rotates at a fixed rate: it eases its angular velocity in
  // and out, so a held direction curves smoothly and straightens softly on
  // release. Velocity is capped, so it can still never reverse instantly.
  let desiredAngularVelocity = 0;
  if (inputs.turn !== 0) {
    // Relative turning (touch buttons): hold to keep rotating.
    desiredAngularVelocity = TURN_SPEED * Math.sign(inputs.turn);
  } else if (inputs.targetAngle !== null) {
    // Directional steering (WASD / arrows): head toward the held heading along
    // the shortest arc, slowing down as it lines up.
    const diff = shortestArc(inputs.targetAngle - player.currentAngle);
    desiredAngularVelocity = clamp(diff / TURN_SETTLE_TIME, -TURN_SPEED, TURN_SPEED);
  }

  const accel = smoothing(TURN_ACCEL, delta);
  player.angularVelocity += (desiredAngularVelocity - player.angularVelocity) * accel;
  player.currentAngle += player.angularVelocity * delta;

  player.isBoosting = inputs.boost && player.score > MIN_SCORE + 2;
  const speed = player.isBoosting ? BOOST_SPEED : BASE_SPEED;

  const head = {
    x: player.segments[0].x + Math.cos(player.currentAngle) * speed * delta,
    y: player.segments[0].y + Math.sin(player.currentAngle) * speed * delta,
  };

  if (isOutOfBounds(head.x, head.y)) {
    return { head, died: true };
  }

  if (player.isBoosting) {
    player.score -= BOOST_COST_PER_SEC * delta;
    if (player.score <= MIN_SCORE) {
      player.isBoosting = false;
      player.score = MIN_SCORE;
    }
  }

  const targetLength = Math.floor(player.score);
  player.path.unshift(head);
  prunePath(player.path, targetLength * SEGMENT_SPACING + 2);
  player.segments = segmentsFromPath(player.path, targetLength);

  return { head, died: false };
}

export function spawnSegments(
  startX: number,
  startY: number,
  angle: number,
  length: number,
): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < length; i++) {
    segments.push({
      x: startX - Math.cos(angle) * i * SEGMENT_SPACING,
      y: startY - Math.sin(angle) * i * SEGMENT_SPACING,
    });
  }
  return segments;
}

export function sanitizePlayerName(name?: string): string {
  // Strip control characters (code points below 32 and DEL), then trim and cap the length.
  const cleaned = Array.from(name ?? '')
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join('');
  const trimmed = cleaned.trim().slice(0, 16);
  return trimmed.length >= 2 ? trimmed : `Snake-${Math.floor(Math.random() * 9000) + 1000}`;
}

export function pickRandomColor(colors: readonly string[]): string {
  return colors[Math.floor(Math.random() * colors.length)];
}
