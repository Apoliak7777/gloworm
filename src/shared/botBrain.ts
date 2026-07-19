import {
  ARENA_RADIUS,
  BOT_MAX_SCORE,
  MIN_SCORE,
  Orb,
  Player,
  Segment,
} from './types';
import { InputState, shortestArc } from './gameLogic';

/**
 * Decides what a bot "presses" this tick. It returns the same InputState a
 * human's keyboard produces, so bots run through the exact same
 * stepLocalPlayer() simulation — identical acceleration, turn easing and
 * segment spacing. That is what makes them read as players rather than props.
 *
 * Priorities, highest first:
 *   1. don't fly into the wall
 *   2. don't run into a body (own or another snake's)
 *   3. chase the best nearby orb
 *   4. otherwise cruise, with a slow wander so idle bots aren't robotic
 */

export type BotMemory = {
  /** Slowly drifting heading used when there is nothing better to do. */
  wander: number;
  /** Ticks remaining of committed boost, so boosting isn't re-decided each tick. */
  boostTicks: number;
};

export function createBotMemory(angle: number): BotMemory {
  return { wander: angle, boostTicks: 0 };
}

/** How far ahead the bot looks for danger, in world units (doubled when boosting). */
const DANGER_LOOKAHEAD = 18;
/** Bots only chase orbs within this radius. */
const ORB_SEEK_RADIUS = 45;
/** Half-angle of the cone the bot considers "ahead of me". */
const DANGER_CONE = Math.PI / 1.8;

function angleTo(from: Segment, x: number, y: number): number {
  return Math.atan2(y - from.y, x - from.x);
}

/**
 * Scores how blocked a candidate heading is. Higher = more dangerous.
 * Considers the arena wall and every segment of every alive snake.
 */
function dangerFor(
  head: Segment,
  heading: number,
  selfId: string,
  players: Record<string, Player>,
  ownSegments: Segment[],
  lookahead: number,
): number {
  const dirX = Math.cos(heading);
  const dirY = Math.sin(heading);

  // Sample several points along the ray, not just its end — a body two units
  // in front of the nose must not be invisible because the probe only looked
  // thirteen units out. Nearer samples are weighted much more heavily.
  const SAMPLES = 5;
  let danger = 0;

  for (let s = 1; s <= SAMPLES; s++) {
    const t = s / SAMPLES;
    const px = head.x + dirX * lookahead * t;
    const py = head.y + dirY * lookahead * t;
    // Imminent collisions matter far more than distant ones.
    const weight = 1 / t;

    const probeRadius = Math.hypot(px, py);
    if (probeRadius > ARENA_RADIUS - 4) {
      danger += (probeRadius - (ARENA_RADIUS - 4)) * 6 * weight;
    }

    const consider = (seg: Segment) => {
      const dx = seg.x - px;
      const dy = seg.y - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < 25) danger += (25 - distSq) * 0.4 * weight;
    };

    for (const id in players) {
      if (id === selfId) continue;
      const other = players[id];
      if (other.state !== 'alive' || !other.segments?.length) continue;
      // Broad phase: a snake's body trails back from its head, so if the head
      // is beyond the body's possible reach we can skip all of its segments.
      const otherHead = other.segments[0];
      const reach = other.segments.length * 0.5 + 8;
      if (Math.hypot(otherHead.x - px, otherHead.y - py) > reach) continue;
      for (const seg of other.segments) consider(seg);
    }

    // Own body, skipping the neck which is always adjacent to the head.
    for (let i = 12; i < ownSegments.length; i++) consider(ownSegments[i]);
  }

  return danger;
}

export function decideBotInput(
  bot: Player,
  memory: BotMemory,
  ownSegments: Segment[],
  currentAngle: number,
  players: Record<string, Player>,
  orbs: Record<string, Orb>,
  delta: number,
): InputState {
  const head = ownSegments[0];
  if (!head) return { targetAngle: null, turn: 0, boost: false };

  // Wander drifts slowly so bots with nothing to chase still look alive.
  memory.wander += (Math.random() - 0.5) * 1.2 * delta;

  // --- pick a goal -------------------------------------------------------
  let goalAngle = memory.wander;

  let bestOrb: Orb | null = null;
  let bestOrbScore = -Infinity;
  for (const id in orbs) {
    const orb = orbs[id];
    const dist = Math.hypot(orb.x - head.x, orb.y - head.y);
    if (dist > ORB_SEEK_RADIUS) continue;
    // Prefer close and valuable orbs, and mildly prefer ones roughly ahead so
    // the bot doesn't constantly double back on itself.
    const heading = angleTo(head, orb.x, orb.y);
    const turnCost = Math.abs(shortestArc(heading - currentAngle)) * 4;
    const score = orb.value * 10 - dist - turnCost;
    if (score > bestOrbScore) {
      bestOrbScore = score;
      bestOrb = orb;
    }
  }
  if (bestOrb) goalAngle = angleTo(head, bestOrb.x, bestOrb.y);

  // Always head back toward the middle when hugging the wall. This overrides
  // orb greed — a tasty orb next to the wall is not worth dying for.
  const radius = Math.hypot(head.x, head.y);
  if (radius > ARENA_RADIUS - 25) {
    goalAngle = angleTo(head, 0, 0);
  }

  // --- steer around danger ----------------------------------------------
  // Look further ahead when moving faster, so boosting bots still have room to
  // turn out of trouble.
  const lookahead = bot.isBoosting ? DANGER_LOOKAHEAD * 2 : DANGER_LOOKAHEAD;

  // Sample headings fanning out from the goal and take the safest one that is
  // still roughly in the direction we want to go.
  let bestHeading = goalAngle;
  let bestCost = Infinity;
  for (let i = -8; i <= 8; i++) {
    const heading = goalAngle + (i / 8) * DANGER_CONE;
    const danger = dangerFor(head, heading, bot.id, players, ownSegments, lookahead);
    // Penalise deviating from the goal and from where we're already pointing,
    // but only mildly — survival dominates.
    const deviation = Math.abs(shortestArc(heading - goalAngle)) * 1.5;
    const swerve = Math.abs(shortestArc(heading - currentAngle)) * 1.0;
    const cost = danger + deviation + swerve;
    if (cost < bestCost) {
      bestCost = cost;
      bestHeading = heading;
    }
  }

  // --- boost decision ----------------------------------------------------
  if (memory.boostTicks > 0) {
    memory.boostTicks--;
  } else if (
    bot.score > MIN_SCORE + 25 &&
    bot.score < BOT_MAX_SCORE &&
    bestCost < 1 &&
    Math.random() < 0.02
  ) {
    // Occasional confident sprint when the path ahead is clear.
    memory.boostTicks = 10 + Math.floor(Math.random() * 20);
  }

  return {
    targetAngle: bestHeading,
    turn: 0,
    boost: memory.boostTicks > 0 && bot.score > MIN_SCORE + 10,
  };
}

const BOT_NAMES = [
  'Viper', 'Nyx', 'Kobra', 'Zephyr', 'Ion', 'Quasar', 'Rift', 'Onyx',
  'Vex', 'Lumen', 'Pulse', 'Cinder', 'Drift', 'Echo', 'Flux', 'Nova',
];

export function pickBotName(taken: Set<string>): string {
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}
