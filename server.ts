import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ARENA_RADIUS,
  BOOST_SPEED,
  BOT_MAX_SCORE,
  BOT_RESPAWN_MS,
  GameState,
  JoinPayload,
  MAX_ACCEPTED_SEGMENTS,
  MAX_BOTS,
  MAX_FRAME_DELTA,
  NEON_COLORS,
  ORB_COLLECT_RADIUS,
  Orb,
  Player,
  PlayerUpdatePayload,
  StateBroadcast,
  TARGET_POPULATION,
  TICK_RATE,
  MAX_ORBS,
  MAX_ORBS_HARD,
  INITIAL_LENGTH,
  MIN_SCORE,
} from './src/shared/types.ts';
import {
  LocalPlayerState,
  checkOrbCollision,
  checkOtherPlayerCollisions,
  checkSelfCollision,
  createLocalPlayerState,
  initPathFromSegments,
  pickRandomColor,
  sanitizePlayerName,
  spawnSegments,
  stepLocalPlayer,
} from './src/shared/gameLogic.ts';
import { BotMemory, createBotMemory, decideBotInput, pickBotName } from './src/shared/botBrain.ts';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

// In a bundled/standalone build there is no real module file to resolve, so
// fall back to the working directory rather than crashing at startup.
const __dirname = (() => {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * The standalone executable build injects the whole client here (see
 * scripts/build-exe.mjs), so the binary needs no files beside it. Undefined in
 * every normal run, where the client comes from vite or dist/.
 */
type EmbeddedAsset = { type: string; body: string };
const embeddedAssets: Record<string, EmbeddedAsset> | undefined = (
  globalThis as { __GLOWORM_ASSETS__?: Record<string, EmbeddedAsset> }
).__GLOWORM_ASSETS__;

/** Optional hook the executable uses to announce itself and open a browser. */
const onListening: ((port: number) => void) | undefined = (
  globalThis as { __GLOWORM_ON_LISTENING__?: (port: number) => void }
).__GLOWORM_ON_LISTENING__;

// How many consecutive rejected updates before we trust the client again.
// Recovers players whose position drifted from lag spikes instead of
// freezing them in place forever.
const MAX_REJECTED_UPDATES = 8;
const JOIN_COOLDOWN_MS = 300;
const DEAD_PLAYER_TTL_MS = 10_000;

const state: GameState = {
  players: {},
  orbs: {},
  leaderboard: [],
  playerCount: 0,
};

const usedNames = new Set<string>();
const namesBySocket = new Map<string, string>();
const rejectedUpdates = new Map<string, number>();
const deathTimes = new Map<string, number>();
const lastJoinTimes = new Map<string, number>();
/** When each player's last movement update was accepted (for pickup tolerance). */
const lastUpdateTimes = new Map<string, number>();

const round2 = (n: number) => Math.round(n * 100) / 100;

// Orb ids are a short base36 counter rather than a UUID: at 20 Hz the id is
// the single most-repeated string in the protocol, and 36 chars of UUID cost
// more than the coordinates they identify.
let nextOrbId = 0;
const makeOrbId = () => (nextOrbId++).toString(36);

// Orb changes accumulated since the last broadcast.
let orbsAdded: Orb[] = [];
let orbsRemoved: string[] = [];

function removeOrb(id: string) {
  if (!state.orbs[id]) return;
  delete state.orbs[id];
  orbsRemoved.push(id);
}

/** Uniformly random point inside a disc of the given radius (centered on origin). */
function randomPointInDisc(radius: number): { x: number; y: number } {
  const r = radius * Math.sqrt(Math.random());
  const theta = Math.random() * Math.PI * 2;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
}

/**
 * Finds a spawn point that isn't inside somebody's body. Death is detected
 * client-side on the very first simulated frame, so spawning on top of a snake
 * is an instant, uncontestable death — and bots make that far more likely.
 */
function findSafeSpawn(): { x: number; y: number } {
  let best = randomPointInDisc(ARENA_RADIUS - 15);
  let bestClearance = -Infinity;

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = randomPointInDisc(ARENA_RADIUS - 15);
    let clearance = Infinity;

    for (const id in state.players) {
      const other = state.players[id];
      if (other.state !== 'alive' || !Array.isArray(other.segments)) continue;
      for (const seg of other.segments) {
        const d = Math.hypot(seg.x - candidate.x, seg.y - candidate.y);
        if (d < clearance) clearance = d;
      }
    }

    if (clearance > 14) return candidate;
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = candidate;
    }
  }
  return best;
}

function spawnOrb(x?: number, y?: number, value = 1, color?: string, force = false) {
  const orbCount = Object.keys(state.orbs).length;
  if (orbCount >= MAX_ORBS_HARD) return;
  if (!force && orbCount >= MAX_ORBS) return;
  // Keep orbs inside the circular wall so none are stranded past the ring.
  const p = randomPointInDisc(ARENA_RADIUS - 2);
  const id = makeOrbId();
  const orb: Orb = {
    id,
    x: round2(x ?? p.x),
    y: round2(y ?? p.y),
    value,
    color: color ?? pickRandomColor(NEON_COLORS),
  };
  state.orbs[id] = orb;
  orbsAdded.push(orb);
}

function dropPlayerOrbs(player: Player) {
  if (!Array.isArray(player.segments)) return;
  player.segments.forEach((seg, i) => {
    if (!seg || !Number.isFinite(seg.x) || !Number.isFinite(seg.y)) return;
    if (i % 2 === 0) {
      const value = i === 0 ? 3 : 1;
      spawnOrb(seg.x, seg.y, value, player.color, true);
    }
  });
}

function claimName(socketId: string, requestedName?: string): string {
  const previous = namesBySocket.get(socketId);
  if (previous) usedNames.delete(previous);

  const name = sanitizePlayerName(requestedName);
  let finalName = name;
  let suffix = 1;
  while (usedNames.has(finalName)) {
    finalName = `${name.slice(0, 12)}-${suffix++}`;
  }
  usedNames.add(finalName);
  namesBySocket.set(socketId, finalName);
  return finalName;
}

function releaseName(socketId: string) {
  const name = namesBySocket.get(socketId);
  if (name) {
    usedNames.delete(name);
    namesBySocket.delete(socketId);
  }
}

function createPlayer(socketId: string, payload: JoinPayload): Player {
  const finalName = claimName(socketId, payload.name);
  const requestedColor = NEON_COLORS.find((c) => c === payload.color);

  // Spawn clear of other snakes, heading roughly inward so a fresh player
  // isn't immediately pointed at the wall.
  const start = findSafeSpawn();
  const angle = Math.atan2(-start.y, -start.x) + (Math.random() - 0.5) * 1.2;

  return {
    id: socketId,
    name: finalName,
    color: requestedColor ?? pickRandomColor(NEON_COLORS),
    segments: spawnSegments(start.x, start.y, angle, INITIAL_LENGTH),
    score: INITIAL_LENGTH,
    isBoosting: false,
    state: 'alive',
    currentAngle: angle,
  };
}

const MAX_MOVE = 8;
/** How close a claimed killer must be to the victim's head to get credit. */
const KILL_CREDIT_RADIUS = 6;
const MAX_SCORE_DELTA = 5;

/**
 * Structural validity of an incoming payload — always enforced, for BOTH alive
 * and dead states, and never bypassed by the resync path. A malformed payload
 * (missing/garbage segments, non-finite numbers) would otherwise crash the
 * broadcast loop, so this is the server's crash guard against hostile clients.
 */
function isStructurallyValid(data: PlayerUpdatePayload): boolean {
  if (!Array.isArray(data.segments) || !data.segments.length) return false;
  if (data.segments.length > MAX_ACCEPTED_SEGMENTS) return false;
  if (typeof data.score !== 'number' || !Number.isFinite(data.score)) return false;
  for (const seg of data.segments) {
    if (!seg || !Number.isFinite(seg.x) || !Number.isFinite(seg.y)) return false;
  }
  return true;
}

/**
 * Plausibility of the movement itself (speed + score growth). This is the only
 * thing the resync path relaxes after repeated lag-spike rejections.
 */
function isPlausibleMove(player: Player, data: PlayerUpdatePayload): boolean {
  const prevHead = player.segments[0];
  if (!prevHead) return true;

  const head = data.segments[0];
  const dx = head.x - prevHead.x;
  const dy = head.y - prevHead.y;
  if (dx * dx + dy * dy > MAX_MOVE * MAX_MOVE) return false;

  if (data.score > player.score + MAX_SCORE_DELTA) return false;
  if (data.score < MIN_SCORE) return false;

  return true;
}

// --- Bots -----------------------------------------------------------------
// Bots run the *same* shared simulation as human clients (stepLocalPlayer),
// so their movement feel, turn easing and segment spacing are identical.

type BotRuntime = {
  sim: LocalPlayerState;
  memory: BotMemory;
  respawnAt: number | null;
};

const bots = new Map<string, BotRuntime>();
let nextBotId = 0;

function spawnBot() {
  if (bots.size >= MAX_BOTS) return;

  const id = `bot-${nextBotId++}`;
  const taken = new Set(Object.values(state.players).map((p) => p.name));
  const name = pickBotName(taken);
  const finalName = claimName(id, name);

  const start = findSafeSpawn();
  const angle = Math.atan2(-start.y, -start.x) + (Math.random() - 0.5) * 1.2;
  const segments = spawnSegments(start.x, start.y, angle, INITIAL_LENGTH);

  state.players[id] = {
    id,
    name: finalName,
    color: pickRandomColor(NEON_COLORS),
    segments,
    score: INITIAL_LENGTH,
    isBoosting: false,
    state: 'alive',
    currentAngle: angle,
    isBot: true,
    kills: 0,
  };

  const sim = createLocalPlayerState();
  sim.active = true;
  sim.segments = segments.map((s) => ({ ...s }));
  sim.score = INITIAL_LENGTH;
  sim.currentAngle = angle;
  initPathFromSegments(sim, segments);

  bots.set(id, { sim, memory: createBotMemory(angle), respawnAt: null });
}

/** Puts a dead bot back in play under its existing id. */
function respawnBot(id: string, bot: BotRuntime) {
  const player = state.players[id];
  if (!player) return;

  const start = findSafeSpawn();
  const angle = Math.atan2(-start.y, -start.x) + (Math.random() - 0.5) * 1.2;
  const segments = spawnSegments(start.x, start.y, angle, INITIAL_LENGTH);

  player.segments = segments;
  player.score = INITIAL_LENGTH;
  player.currentAngle = angle;
  player.isBoosting = false;
  player.state = 'alive';

  bot.sim = createLocalPlayerState();
  bot.sim.active = true;
  bot.sim.segments = segments.map((s) => ({ ...s }));
  bot.sim.score = INITIAL_LENGTH;
  bot.sim.currentAngle = angle;
  initPathFromSegments(bot.sim, segments);
  bot.memory = createBotMemory(angle);
  bot.respawnAt = null;
  deathTimes.delete(id);
}

function stepBots(delta: number) {
  const now = Date.now();

  for (const [id, bot] of bots) {
    const player = state.players[id];
    if (!player) {
      bots.delete(id);
      continue;
    }

    if (player.state === 'dead') {
      if (bot.respawnAt === null) bot.respawnAt = now + BOT_RESPAWN_MS;
      if (now >= bot.respawnAt) {
        // Respawn in place, keeping the same id. Minting a new id changes the
        // React key on the client, which unmounts and rebuilds the whole Snake
        // component (geometries, materials, a 2500-instance buffer) several
        // times a minute — a visible hitch for every player.
        respawnBot(id, bot);
      }
      continue;
    }

    const inputs = decideBotInput(
      player,
      bot.memory,
      bot.sim.segments,
      bot.sim.currentAngle,
      state.players,
      state.orbs,
      delta,
    );

    const { head, died } = stepLocalPlayer(bot.sim, inputs, delta);

    if (died) {
      applyBotState(player, bot);
      killPlayer(player);
      continue;
    }

    // Collect any orbs the bot's head touched.
    for (const orbId in state.orbs) {
      const orb = state.orbs[orbId];
      if (checkOrbCollision(head, orb.x, orb.y)) {
        removeOrb(orbId);
        bot.sim.score = Math.min(BOT_MAX_SCORE, bot.sim.score + orb.value);
      }
    }

    const selfHit = checkSelfCollision(head, bot.sim.segments);
    const killerId = checkOtherPlayerCollisions(head, id, state.players);

    if (selfHit || killerId) {
      applyBotState(player, bot);
      killPlayer(player, killerId ?? undefined);
      continue;
    }

    applyBotState(player, bot);
  }
}

function applyBotState(player: Player, bot: BotRuntime) {
  player.segments = bot.sim.segments;
  player.score = bot.sim.score;
  player.currentAngle = bot.sim.currentAngle;
  player.isBoosting = bot.sim.isBoosting;
}

function topUpBots() {
  const alive = Object.values(state.players).filter((p) => p.state === 'alive').length;
  if (alive < TARGET_POPULATION) spawnBot();
}

function killPlayer(player: Player, killerId?: string) {
  player.state = 'dead';
  deathTimes.set(player.id, Date.now());
  dropPlayerOrbs(player);

  // Credit the kill only if the claimed killer is real, alive, someone else,
  // and actually close enough to have done it — the claim arrives from the
  // victim's own client, so it must be checked.
  let killer: Player | undefined;
  if (killerId && killerId !== player.id) {
    const candidate = state.players[killerId];
    const victimHead = player.segments?.[0];
    if (candidate?.state === 'alive' && victimHead && Array.isArray(candidate.segments)) {
      const closeEnough = candidate.segments.some(
        (seg) => Math.hypot(seg.x - victimHead.x, seg.y - victimHead.y) <= KILL_CREDIT_RADIUS,
      );
      if (closeEnough) {
        killer = candidate;
        candidate.kills = (candidate.kills ?? 0) + 1;
      }
    }
  }

  io.emit('player_died', {
    name: player.name,
    color: player.color,
    score: Math.floor(player.score),
    killerName: killer?.name,
    killerColor: killer?.color,
  });
}

/** Broadcast payload with rounded segment coordinates (roughly halves the JSON size). */
function serializeState(): StateBroadcast {
  const players: Record<string, Player> = {};
  for (const id in state.players) {
    const p = state.players[id];
    const segments = Array.isArray(p.segments) ? p.segments : [];
    players[id] = {
      ...p,
      score: Math.round(p.score * 10) / 10,
      currentAngle: Math.round(p.currentAngle * 1000) / 1000,
      segments: segments.map((s) => ({ x: round2(s.x), y: round2(s.y) })),
    };
  }

  const payload: StateBroadcast = {
    players,
    leaderboard: state.leaderboard,
    playerCount: state.playerCount,
  };
  if (orbsAdded.length) payload.orbsAdded = orbsAdded;
  if (orbsRemoved.length) payload.orbsRemoved = orbsRemoved;
  return payload;
}

for (let i = 0; i < 200; i++) spawnOrb();

io.on('connection', (socket) => {
  // Baseline for the delta stream. Re-sent on join so a reconnecting client
  // can never drift. Applying a delta twice is idempotent, so the overlap
  // between this snapshot and the next broadcast is harmless.
  socket.emit('orbs_snapshot', Object.values(state.orbs));

  socket.on('ping_check', (start: number) => {
    socket.emit('pong_check', start);
  });

  socket.on('join', (payload: JoinPayload = {}) => {
    const now = Date.now();
    const lastJoin = lastJoinTimes.get(socket.id) ?? 0;
    if (now - lastJoin < JOIN_COOLDOWN_MS) return;
    lastJoinTimes.set(socket.id, now);

    // Rejoining while still alive must count as a death, otherwise it is a
    // free escape from an imminent collision with no mass dropped.
    const existing = state.players[socket.id];
    if (existing?.state === 'alive') killPlayer(existing);

    state.players[socket.id] = createPlayer(socket.id, payload);
    rejectedUpdates.delete(socket.id);
    deathTimes.delete(socket.id);
    socket.emit('orbs_snapshot', Object.values(state.orbs));
    socket.emit('init', socket.id);
  });

  socket.on('update_state', (data: PlayerUpdatePayload) => {
    const player = state.players[socket.id];
    if (!player || player.state !== 'alive') return;

    // Crash guard: reject structurally invalid payloads outright — this check
    // is never relaxed, even on resync.
    if (!isStructurallyValid(data)) return;

    if (!isPlausibleMove(player, data)) {
      const rejected = (rejectedUpdates.get(socket.id) ?? 0) + 1;
      rejectedUpdates.set(socket.id, rejected);
      // After a lag spike the client is legitimately far from the last
      // accepted position; without this the player would freeze forever.
      if (rejected < MAX_REJECTED_UPDATES) return;
    }
    rejectedUpdates.set(socket.id, 0);
    lastUpdateTimes.set(socket.id, Date.now());

    player.segments = data.segments;
    // Clamp the score even on resync so a forced fallthrough can never inject
    // an arbitrary value onto the leaderboard.
    player.score = Math.max(MIN_SCORE, Math.min(data.score, player.score + MAX_SCORE_DELTA));
    player.currentAngle = Number.isFinite(data.currentAngle) ? data.currentAngle : player.currentAngle;
    player.isBoosting = Boolean(data.isBoosting);

    if (data.state === 'dead') {
      killPlayer(player, typeof data.killedBy === 'string' ? data.killedBy : undefined);
    }
  });

  socket.on('collect_orb', (orbId: string) => {
    if (typeof orbId !== 'string') return;
    const player = state.players[socket.id];
    const orb = state.orbs[orbId];
    if (!player || player.state !== 'alive' || !orb) return;

    const head = player.segments[0];
    if (!head) return;

    // The stored head is the last *accepted* update, so by the time this
    // message lands the client has legitimately moved on. Allow exactly the
    // distance it could have covered at boost speed since then (plus a little
    // for jitter) — without this, pickups at speed are wrongly rejected and
    // orbs visibly flicker back for the player.
    const elapsed = Math.min((Date.now() - (lastUpdateTimes.get(socket.id) ?? Date.now())) / 1000, 0.3);
    const tolerance = BOOST_SPEED * elapsed + 0.5;
    const reach = ORB_COLLECT_RADIUS + tolerance;
    const dx = orb.x - head.x;
    const dy = orb.y - head.y;
    if (dx * dx + dy * dy > reach * reach) return;

    removeOrb(orbId);
    player.score += orb.value;
  });

  socket.on('disconnect', () => {
    const player = state.players[socket.id];
    if (player?.state === 'alive') dropPlayerOrbs(player);
    releaseName(socket.id);
    rejectedUpdates.delete(socket.id);
    deathTimes.delete(socket.id);
    lastJoinTimes.delete(socket.id);
    lastUpdateTimes.delete(socket.id);
    delete state.players[socket.id];
  });
});

let lastTickAt = Date.now();

setInterval(() => {
  const now = Date.now();
  // Real elapsed time, so bots move at the same speed even if the event loop
  // runs late. Clamped for the same reason the client clamps its frame delta.
  const delta = Math.min((now - lastTickAt) / 1000, MAX_FRAME_DELTA);
  lastTickAt = now;

  stepBots(delta);
  topUpBots();

  for (const id in state.players) {
    const player = state.players[id];

    if (player.state === 'dead') {
      // Bots own their own death/respawn lifecycle in stepBots().
      if (player.isBot) continue;
      const diedAt = deathTimes.get(id) ?? now;
      if (now - diedAt > DEAD_PLAYER_TTL_MS) {
        deathTimes.delete(id);
        delete state.players[id];
      }
      continue;
    }

    if (player.isBoosting && player.segments.length > MIN_SCORE) {
      if (Math.random() < 0.12) {
        const tail = player.segments[player.segments.length - 1];
        spawnOrb(tail.x, tail.y, 1, player.color, true);
      }
    }
  }

  if (Math.random() < 0.25) spawnOrb();

  state.playerCount = Object.values(state.players).filter((p) => p.state === 'alive').length;
  state.leaderboard = Object.values(state.players)
    .filter((p) => p.state === 'alive')
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: Math.floor(p.score),
      color: p.color,
    }));

  io.emit('state', serializeState());
  // Deltas are consumed by the broadcast above; start accumulating fresh ones.
  if (orbsAdded.length) orbsAdded = [];
  if (orbsRemoved.length) orbsRemoved = [];
}, 1000 / TICK_RATE);

async function startServer() {
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', players: state.playerCount });
  });

  if (embeddedAssets) {
    // Standalone executable build: the client is compiled into the binary, so
    // there is no dist/ directory on disk to serve from.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const key = req.path === '/' ? '/index.html' : req.path;
      const asset = embeddedAssets[key] ?? embeddedAssets['/index.html'];
      if (!asset) return next();
      res.type(asset.type).send(Buffer.from(asset.body, 'base64'));
    });
  } else if (!isProduction) {
    // Dev-only dynamic import keeps vite out of the production runtime.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`GLOWORM running on http://localhost:${PORT}`);
    onListening?.(PORT);
  });
}

// Last-resort net: a single malformed event must never take the whole arena down.
process.on('uncaughtException', (err) => {
  console.error('[gloworm] uncaught exception:', err);
});

startServer();
