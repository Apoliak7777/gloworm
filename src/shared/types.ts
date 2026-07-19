export type GameState = {
  players: Record<string, Player>;
  orbs: Record<string, Orb>;
  leaderboard: LeaderboardEntry[];
  playerCount: number;
};

/**
 * What actually goes over the wire 20x/s.
 *
 * Orbs are synced as deltas rather than resent every tick: they are static
 * until collected, and a full orb dump was ~55 KB/tick (~888 KB/s per client),
 * dwarfing everything else. Clients apply `orbsAdded`/`orbsRemoved` onto the
 * snapshot they received on connect.
 */
export type StateBroadcast = {
  players: Record<string, Player>;
  leaderboard: LeaderboardEntry[];
  playerCount: number;
  orbsAdded?: Orb[];
  orbsRemoved?: string[];
};

export type PlayerState = 'alive' | 'dead';

export type Player = {
  id: string;
  name: string;
  color: string;
  segments: Segment[];
  score: number;
  isBoosting: boolean;
  state: PlayerState;
  currentAngle: number;
  /** AI-controlled snake, simulated server-side with the same shared logic. */
  isBot?: boolean;
  kills?: number;
};

export type Segment = { x: number; y: number };

export type Orb = {
  id: string;
  x: number;
  y: number;
  value: number;
  color: string;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  score: number;
  color: string;
};

export type PlayerUpdatePayload = {
  segments: Segment[];
  score: number;
  currentAngle: number;
  isBoosting: boolean;
  state: PlayerState;
  /** Id of the snake we collided with, when reporting a death. Server-verified. */
  killedBy?: string;
};

export type JoinPayload = {
  name?: string;
  color?: string;
};

export type DeathEvent = {
  name: string;
  color: string;
  score: number;
  /** Name of the snake that got the kill, when the death was a collision. */
  killerName?: string;
  killerColor?: string;
};

/** Bot tuning. Bots exist so a solo visitor still lands in a living arena. */
export const TARGET_POPULATION = 7;
export const MAX_BOTS = 8;
/** Bots stay mid-sized: keeps them beatable and bounds broadcast size. */
export const BOT_MAX_SCORE = 130;
export const BOT_RESPAWN_MS = 4000;

export const WORLD_SIZE = 200;
// Radius of the circular arena — matches the glowing wall ring drawn in Arena.tsx.
export const ARENA_RADIUS = WORLD_SIZE / 2 - 1;
export const BASE_SPEED = 18;
export const BOOST_SPEED = 36;
export const TICK_RATE = 20;
export const MAX_ORBS = 400;
export const MAX_ORBS_HARD = 1000;
export const ORB_INSTANCE_CAP = 1200;
export const SNAKE_INSTANCE_CAP = 2500;
/**
 * Hard cap on segments the server will accept in one update. Derived from the
 * render cap so a snake can never validate at a length the client would draw
 * truncated.
 */
export const MAX_ACCEPTED_SEGMENTS = SNAKE_INSTANCE_CAP;
export const INITIAL_LENGTH = 12;
export const SEGMENT_SPACING = 0.5;
/**
 * Peak turn rate (rad/s), reached only after the ease-in below — never
 * instantly. Because steering is hold-to-rotate, this directly sets the turn
 * radius: speed / TURN_SPEED. At 4.4 that is ~4.1 units at base speed, so a
 * full circle is ~26 units of body — a snake stays clear of itself until about
 * 59 segments. Faster rates look snappy but let a modest snake loop into its
 * own tail while simply holding a turn.
 */
export const TURN_SPEED = 4.4;
// How fast angular velocity ramps toward its target — higher = more responsive,
// lower = softer. This is what makes held turns curve instead of snapping.
export const TURN_ACCEL = 30;
// Time constant for settling onto a held heading; larger = gentler arrival.
// Steering behaves as a damped oscillator with damping ratio
// sqrt(TURN_ACCEL * TURN_SETTLE_TIME) / 2 — keep the product >= 4 so it stays
// critically damped and glides onto the heading without overshooting.
export const TURN_SETTLE_TIME = 0.14;
export const MIN_SCORE = INITIAL_LENGTH;
export const HEAD_RADIUS = 0.8;
export const BODY_RADIUS = 0.6;
export const ORB_RADIUS = 0.5;
export const COLLISION_RADIUS = HEAD_RADIUS + BODY_RADIUS - 0.15;
export const ORB_COLLECT_RADIUS = HEAD_RADIUS + ORB_RADIUS;
export const SELF_COLLISION_SKIP = 8;
/**
 * Whether running into your own body kills you.
 *
 * Off by default, matching slither.io. Steering is hold-to-rotate, so a held
 * turn traces a circle of radius speed/TURN_SPEED (~4.1 units) — about 51
 * segments of body. With self-collision on, any snake longer than that dies
 * simply for holding the turn key, which punishes the primary control. Danger
 * comes from other snakes instead. Flip to true for classic-snake rules.
 */
export const SELF_COLLISION_ENABLED = false;
export const BOOST_COST_PER_SEC = 2.5;
// Longest step the local simulation will integrate in one frame (seconds).
// Prevents huge teleport steps (and unfair boundary deaths) after tab switches.
export const MAX_FRAME_DELTA = 0.1;
export const NEON_COLORS = [
  '#ff2d95',
  '#ff6b35',
  '#f9f871',
  '#00f5a0',
  '#00d4ff',
  '#a855f7',
  '#ff4d6d',
  '#4cc9f0',
] as const;
