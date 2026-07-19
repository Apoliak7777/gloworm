import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { DeathEvent, GameState, Orb, PlayerUpdatePayload, StateBroadcast } from '../shared/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type FeedEntry = DeathEvent & { id: number; at: number };

export type LastDeath = { score: number; rank: number; newBest: boolean };

const NAME_KEY = 'gloworm-name';
const COLOR_KEY = 'gloworm-color';
const BEST_KEY = 'gloworm-best';

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode / blocked storage — persistence is best-effort.
  }
}

interface GameStore {
  socket: Socket | null;
  gameState: GameState | null;
  playerId: string | null;
  playerName: string;
  preferredColor: string;
  connectionStatus: ConnectionStatus;
  ping: number;
  deathFeed: FeedEntry[];
  lastDeath: LastDeath | null;
  bestScore: number;
  connect: () => void;
  joinGame: (name?: string) => void;
  setPlayerName: (name: string) => void;
  setPreferredColor: (color: string) => void;
  recordDeath: (score: number, rank: number) => void;
  sendPlayerState: (data: PlayerUpdatePayload) => void;
  sendCollectOrb: (orbId: string) => void;
}

export const globalGameState: { current: GameState | null } = { current: null };
/** Client-owned orb map, kept in sync via snapshot + deltas (stable identity). */
const clientOrbs: Record<string, Orb> = {};
let lastUiUpdate = 0;
let feedId = 0;

export const useGameStore = create<GameStore>((set, get) => ({
  socket: null,
  gameState: null,
  playerId: null,
  playerName: readStorage(NAME_KEY),
  preferredColor: readStorage(COLOR_KEY),
  connectionStatus: 'connecting',
  ping: 0,
  deathFeed: [],
  lastDeath: null,
  bestScore: Number(readStorage(BEST_KEY)) || 0,

  setPlayerName: (name) => {
    writeStorage(NAME_KEY, name);
    set({ playerName: name });
  },

  setPreferredColor: (color) => {
    writeStorage(COLOR_KEY, color);
    set({ preferredColor: color });
  },

  recordDeath: (score, rank) => {
    const finalScore = Math.floor(score);
    const { bestScore } = get();
    const newBest = finalScore > bestScore;
    if (newBest) writeStorage(BEST_KEY, String(finalScore));
    set({
      lastDeath: { score: finalScore, rank, newBest },
      bestScore: Math.max(bestScore, finalScore),
    });
  },

  connect: () => {
    if (get().socket) return;

    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      set({ connectionStatus: 'connected' });
    });

    socket.on('pong_check', (start: number) => {
      set({ ping: Math.max(0, Date.now() - start) });
    });

    // The socket auto-reconnects, so the interval lives for the app's
    // lifetime and simply skips beats while disconnected.
    setInterval(() => {
      if (socket.connected) socket.emit('ping_check', Date.now());
    }, 3000);

    socket.on('init', (id: string) => {
      set({ playerId: id, lastDeath: null });
    });

    socket.on('player_died', (event: DeathEvent) => {
      const entry: FeedEntry = { ...event, id: feedId++, at: Date.now() };
      set((s) => ({ deathFeed: [...s.deathFeed.slice(-4), entry] }));
    });

    // Orbs arrive as a one-off snapshot plus per-tick deltas, so the client
    // owns this map for the lifetime of the connection.
    socket.on('orbs_snapshot', (orbs: Orb[]) => {
      for (const id in clientOrbs) delete clientOrbs[id];
      for (const orb of orbs) clientOrbs[orb.id] = orb;
    });

    socket.on('state', (broadcast: StateBroadcast) => {
      if (broadcast.orbsRemoved) {
        for (const id of broadcast.orbsRemoved) delete clientOrbs[id];
      }
      if (broadcast.orbsAdded) {
        for (const orb of broadcast.orbsAdded) clientOrbs[orb.id] = orb;
      }

      const state: GameState = {
        players: broadcast.players,
        orbs: clientOrbs,
        leaderboard: broadcast.leaderboard,
        playerCount: broadcast.playerCount,
      };
      globalGameState.current = state;

      const now = Date.now();
      if (now - lastUiUpdate > 80) {
        set({ gameState: state });
        lastUiUpdate = now;
      }
    });

    socket.on('disconnect', () => {
      set({ connectionStatus: 'disconnected', playerId: null });
    });

    socket.io.on('reconnect_attempt', () => {
      set({ connectionStatus: 'connecting' });
    });

    set({ socket });
  },

  joinGame: (name) => {
    const { socket, playerName, preferredColor } = get();
    if (socket) {
      socket.emit('join', {
        name: name ?? playerName,
        color: preferredColor || undefined,
      });
    }
  },

  sendPlayerState: (data) => {
    const { socket } = get();
    if (socket) socket.emit('update_state', data);
  },

  sendCollectOrb: (orbId) => {
    const { socket } = get();
    if (socket) socket.emit('collect_orb', orbId);
  },
}));
