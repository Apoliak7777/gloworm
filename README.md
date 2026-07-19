<div align="center">

[![Slovencina](https://img.shields.io/badge/SK-Sloven%C4%8Dina-30363d?style=for-the-badge)](README.sk.md) [![English](https://img.shields.io/badge/EN-English-2ea043?style=for-the-badge)](README.md)

</div>

# GLOWORM — Neon Arena 🐍✨

Real-time multiplayer snake arena in the browser. Collect glowing orbs, outgrow rivals, and survive the void.

[![CI](https://github.com/Apoliak7777/gloworm/actions/workflows/ci.yml/badge.svg)](https://github.com/Apoliak7777/gloworm/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-R3F-000000?logo=threedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socketdotio&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

Built with **React Three Fiber**, **Three.js**, **Socket.IO**, **Zustand**, and **TypeScript** (strict mode).

## Features

### Gameplay
- ⚡ Real-time multiplayer over WebSockets (20 Hz server tick)
- 🤖 **AI snakes fill the arena** — never an empty lobby, and they run the *same*
  shared simulation as human players, so they move and turn identically
- 🎯 Client-side prediction — your snake reacts instantly, no input lag
- 🧭 Frame-rate-independent movement — snake length is identical at 30 FPS and 144 FPS
- 🚀 Boost mechanic — trade length for speed, drop orbs behind you
- 💀 Death drops your body as collectible orbs for everyone else
- ⚔️ Kill attribution — the feed shows who ate whom, verified server-side
- 🏆 Live leaderboard, minimap radar, and kill feed

### Polish
- 🌈 Neon 3D visuals with bloom + vignette post-processing and a starfield
- 👀 Snakes have eyes that look where they're going
- 🎆 Particle burst explosions when any snake dies
- 🔊 Synthesized sound effects (Web Audio — zero audio assets), mutable
- 🎨 Pick your neon color before spawning
- 📈 Personal best + rank tracking (persisted locally)
- 📱 Touch controls for mobile, keyboard for desktop

### Engineering
- 🛡️ Server-side movement & score validation with lag-spike resync, hardened
  against malformed payloads and score injection
- 📉 **Delta-synced orbs** — orbs are static until eaten, so they're sent once and
  then only as add/remove events. Measured: **888 KB/s → 9 KB/s per client (-99%)**
- 📦 Rounded coordinates, short base36 ids, capped entity counts
- ⚙️ Instanced rendering with explicit GPU update ranges (upload only what changed)
- 🧪 Unit-tested simulation core (Vitest) — frame-rate independence and the
  steering damping invariant are verified, not just claimed
- 🔒 Strict TypeScript everywhere, shared types between client and server
- 🐳 Dockerfile + GitHub Actions CI included

## Download and play

Grab **`gloworm-windows-x64.exe`** from the [latest release](https://github.com/Apoliak7777/gloworm/releases/latest) and double-click it. No install, no Node.js, nothing to configure — the server starts, your browser opens, and AI snakes are already in the arena.

It also prints a LAN address, so anyone on your network can join the same game by opening that link.

## Quick Start (from source)

**Requirements:** Node.js 20+

```bash
# Install dependencies
npm install

# Start dev server (frontend + backend on one port)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Open a second tab to test multiplayer.

## Controls

| Input | Action |
|-------|--------|
| `A` / `←` (hold) | Turn left, continuously |
| `D` / `→` (hold) | Turn right, continuously |
| `Space` / `Shift` / `W` / `↑` | Boost (burns length) |
| **Mouse** | Aim: steer toward the cursor |
| **Left click** (hold) | Boost |
| Touch ◀ ▶ / Boost | Mobile controls |

**Hold to turn.** Holding `D` spins the snake clockwise for as long as you hold it — a full circle takes about 1.4 seconds. Rotation is driven by an angular-velocity model, so the snake *accelerates into* the arc and *coasts out* of it rather than snapping on and off.

The mouse is an alternative absolute-aim scheme and never steals control while a turn key is held. Behaviour is [unit-tested](src/shared/gameLogic.test.ts): constant turn rate while held, smooth ramp-in and coast-out, and an identical arc at 30, 60 and 144 FPS.

The turn radius (~4.1 units) is deliberately tuned against the snake's own length, and running into your own body does **not** kill you — slither.io rules. Holding a turn is the primary control, so dying for using it would be a design bug. Flip `SELF_COLLISION_ENABLED` in `src/shared/types.ts` for classic-snake rules.

## Production

```bash
npm run build
npm run start
```

Set `PORT` to change the server port (default `3000`).

### Docker

```bash
docker build -t gloworm .
docker run -p 3000:3000 gloworm
```

## Project Structure

```
├── server.ts              # Express + Socket.IO game server (validation, orbs, bots, leaderboard)
├── src/
│   ├── components/        # React Three Fiber scene & HTML UI
│   ├── hooks/             # Mouse/keyboard/touch input handling
│   ├── shared/            # Types, game logic & bot AI shared by client and server
│   │   ├── gameLogic.ts   # Pure simulation core (also runs the bots)
│   │   ├── gameLogic.test.ts
│   │   └── botBrain.ts    # AI steering decisions
│   ├── store/             # Zustand store + Socket.IO client
│   └── utils/             # Synthesized sound effects
```

## Testing

```bash
npm test          # run the suite once
npm run test:watch
npm run typecheck
```

## How It Works

```
┌──────────┐  update_state (20/s)  ┌──────────┐
│  Client   │ ────────────────────▶ │  Server  │   validates movement,
│ (predicts │ ◀──────────────────── │ (Node +  │   owns orbs & leaderboard,
│  locally) │    state (20 Hz)      │ Socket.IO)│   broadcasts world state
└──────────┘                        └──────────┘
```

- The **server** owns player sessions, orb spawning, the leaderboard, and validates every movement update (max speed, score delta, bounds). After a lag spike it re-syncs the client instead of freezing it.
- Each **client** runs local physics for its own snake and syncs at 20 Hz. Segments are placed along the head's path at fixed spacing, so snake length never depends on frame rate.
- Other players are interpolated for smooth rendering; their heads turn smoothly via shortest-arc angle lerp.
- On death, the snake's body converts to orbs and a `player_died` event feeds the kill ticker.

## License

MIT
