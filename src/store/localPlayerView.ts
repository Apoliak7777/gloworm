import { Segment } from '../shared/types';

/**
 * Live render source for the local player's snake.
 *
 * The shared `globalGameState` snapshot is replaced wholesale ~20x/s by server
 * broadcasts, whose copy of our own snake is both lagged (round-trip) and
 * rounded to 2 decimals. Rendering the local snake from it produced a visible
 * 20 Hz stutter, because React subscribes child (Snake) frame callbacks before
 * parent (GameScene) ones — so Snake drew the stale server position for a frame
 * before GameScene wrote the fresh local one back.
 *
 * GameScene writes this every frame straight from the local simulation, and
 * Snake reads it for the local player. Server state is still used for everyone
 * else.
 */
export const localPlayerView: {
  active: boolean;
  segments: Segment[];
  angle: number;
  isBoosting: boolean;
} = {
  active: false,
  segments: [],
  angle: 0,
  isBoosting: false,
};

export function resetLocalPlayerView() {
  localPlayerView.active = false;
  localPlayerView.segments = [];
  localPlayerView.angle = 0;
  localPlayerView.isBoosting = false;
}
