import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Crown, Link2, Skull, Swords, Trophy, Users, Volume2, VolumeX, Wifi, WifiOff, Zap } from 'lucide-react';
import { Minimap } from './Minimap';
import { TouchControls } from './TouchControls';
import { resetPlayerInputs } from '../hooks/usePlayerInputs';
import { GAME_NAME, GAME_TAGLINE } from '../shared/branding';
import { MIN_SCORE, NEON_COLORS } from '../shared/types';
import { initAudio, isMuted, playJoin, setMuted } from '../utils/sfx';

const FEED_TTL_MS = 6000;

const COLOR_NAMES: Record<string, string> = {
  '#ff2d95': 'Pink',
  '#ff6b35': 'Orange',
  '#f9f871': 'Yellow',
  '#00f5a0': 'Green',
  '#00d4ff': 'Cyan',
  '#a855f7': 'Purple',
  '#ff4d6d': 'Red',
  '#4cc9f0': 'Sky',
};

export function UI() {
  const {
    gameState,
    playerId,
    playerName,
    setPlayerName,
    preferredColor,
    setPreferredColor,
    joinGame,
    connectionStatus,
    ping,
    deathFeed,
    lastDeath,
    bestScore,
  } = useGameStore();

  const [copied, setCopied] = useState(false);
  const [draftName, setDraftName] = useState(playerName);
  const [muted, setMutedState] = useState(isMuted);

  const player = playerId && gameState ? gameState.players[playerId] : null;
  const isAlive = player?.state === 'alive';
  const showMenu = !isAlive;
  const showDeath = showMenu && lastDeath !== null;

  // Length you can still spend on boost before hitting the floor, shown as a
  // fraction of a full "tank". Uses a log curve so it keeps reading as
  // meaningful at high scores instead of pinning at 100% forever.
  const spendable = player ? Math.max(0, player.score - MIN_SCORE - 2) : 0;
  const boostFuel = Math.min(1, Math.log1p(spendable) / Math.log1p(60));
  const recentFeed = deathFeed.filter((entry) => Date.now() - entry.at < FEED_TTL_MS);

  const handlePlay = () => {
    if (connectionStatus !== 'connected') return;
    initAudio();
    playJoin();
    const name = draftName.trim() || playerName;
    setPlayerName(name);
    resetPlayerInputs();
    joinGame(name);
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
      <div className="flex justify-between items-start gap-4 pointer-events-auto">
        <div className="flex flex-col gap-2 z-10">
          <div className="flex items-center gap-3">
            <h1
              className="text-2xl sm:text-3xl font-black tracking-widest"
              style={{
                fontFamily: '"Orbitron", sans-serif',
                background: 'linear-gradient(90deg, #ff2d95, #00d4ff)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                filter: 'drop-shadow(0 0 12px rgba(255,45,149,0.35))',
              }}
            >
              {GAME_NAME}
            </h1>
            <span className="hidden sm:inline text-[10px] font-mono text-white/30 uppercase tracking-[0.35em]">
              {GAME_TAGLINE}
            </span>
          </div>

          {isAlive && player && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <div
                  className="text-lg font-mono font-bold"
                  style={{ color: player.color, textShadow: `0 0 12px ${player.color}` }}
                >
                  {Math.floor(player.score)}
                </div>
                {player.isBoosting && (
                  <span className="flex items-center gap-1 text-xs font-bold uppercase text-fuchsia-300 animate-pulse">
                    <Zap size={12} /> Boost
                  </span>
                )}
              </div>
              <div
                className="h-1.5 w-36 rounded-full bg-white/10 overflow-hidden"
                role="meter"
                aria-label="Boost fuel"
                aria-valuenow={Math.round(boostFuel * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-200"
                  style={{
                    width: `${boostFuel * 100}%`,
                    background: `linear-gradient(90deg, ${player.color}, #ffffff88)`,
                    boxShadow: `0 0 8px ${player.color}`,
                  }}
                />
              </div>
            </div>
          )}

          <AnimatePresence>
            {recentFeed.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-xs font-mono text-white/60"
              >
                {entry.killerName ? (
                  <>
                    <span style={{ color: entry.killerColor }}>{entry.killerName}</span>
                    <Swords size={12} className="text-white/50" role="img" aria-label="eliminated" />
                    <span style={{ color: entry.color }}>{entry.name}</span>
                  </>
                ) : (
                  <>
                    <Skull size={12} className="text-white/50" role="img" aria-label="Eliminated" />
                    <span style={{ color: entry.color }}>{entry.name}</span>
                  </>
                )}
                <span className="text-white/60">— {entry.score}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="hidden sm:flex absolute left-1/2 -translate-x-1/2 top-0 gap-2 opacity-90">
          <div className="flex items-center gap-2 text-xs font-mono text-white bg-white/5 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
            <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded">A</span>
            <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded">D</span>
            <span className="text-white/60 uppercase tracking-wider text-[10px]">Hold to turn</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-white bg-white/5 px-3 py-1.5 rounded-full backdrop-blur-sm border border-white/10">
            <span className="font-bold bg-white/20 px-1.5 py-0.5 rounded">SPACE</span>
            <span className="text-white/60 uppercase tracking-wider text-[10px]">Boost</span>
          </div>
        </div>

        <div className="flex items-center gap-2 z-10">
          <div
            role="status"
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/40 border border-white/10 text-xs font-mono text-white/70"
          >
            {connectionStatus === 'connected' ? (
              <Wifi size={14} className="text-emerald-400" role="img" aria-label="Connected" />
            ) : (
              <WifiOff size={14} className="text-red-400" role="img" aria-label="Disconnected" />
            )}
            <span>{ping}ms</span>
          </div>
          {gameState && (
            <div
              role="status"
              className="flex items-center gap-2 px-3 py-2 rounded-full bg-black/40 border border-white/10 text-xs font-mono text-white/70"
            >
              <Users size={14} role="img" aria-label="Players online" />
              <span>{gameState.playerCount}</span>
            </div>
          )}
          <button
            onClick={toggleMute}
            aria-label={muted ? 'Unmute sounds' : 'Mute sounds'}
            className="flex items-center justify-center w-9 h-9 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-colors"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white text-sm font-bold transition-colors"
          >
            {copied ? <Copy size={16} /> : <Link2 size={16} />}
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Invite'}</span>
          </button>
        </div>
      </div>

      {gameState && gameState.leaderboard.length > 0 && (
        <div className="hidden sm:block absolute top-20 right-4 w-64 bg-black/50 backdrop-blur-md rounded-2xl p-4 border border-white/10 pointer-events-none">
          <div className="flex items-center gap-2 mb-3 text-white/80 font-semibold text-sm">
            <Trophy size={16} className="text-yellow-400" />
            <h2 className="tracking-wider">LEADERBOARD</h2>
          </div>
          <div className="flex flex-col gap-1.5">
            {gameState.leaderboard.map((entry, i) => (
              <div
                key={entry.id}
                className={`flex justify-between items-center text-sm rounded-lg px-2 py-1 ${
                  entry.id === playerId ? 'bg-white/10' : ''
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="text-white/30 w-4 text-xs">
                    {i === 0 ? <Crown size={12} className="text-yellow-400" /> : `${i + 1}.`}
                  </span>
                  <span style={{ color: entry.color }} className="font-medium truncate max-w-[130px]">
                    {entry.name}
                    {entry.id === playerId && ' (you)'}
                  </span>
                </div>
                <span className="font-mono text-white/70 text-xs">{entry.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isAlive && <Minimap />}
      {isAlive && <TouchControls />}

      {/* No AnimatePresence here on purpose: an exit-animating fullscreen overlay
          can linger invisibly (StrictMode ghost) and swallow pointer events. */}
      {showMenu && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-auto bg-black/70 backdrop-blur-md"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={showDeath ? 'Eliminated — play again' : 'Join game'}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="relative max-w-lg w-full mx-4 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/10 via-transparent to-cyan-500/10 pointer-events-none" />

              <div className="relative p-8 flex flex-col items-center gap-6">
                {showDeath && lastDeath ? (
                  <div className="text-center space-y-2">
                    <h2 className="text-4xl font-black text-red-400" style={{ textShadow: '0 0 20px rgba(248,113,113,0.5)' }}>
                      ELIMINATED
                    </h2>
                    <div className="flex items-center justify-center gap-4 font-mono text-sm text-white/60">
                      <span>
                        Length <span className="text-white font-bold">{lastDeath.score}</span>
                      </span>
                      <span>
                        Rank <span className="text-white font-bold">#{lastDeath.rank}</span>
                      </span>
                      <span>
                        Best <span className="text-white font-bold">{bestScore}</span>
                      </span>
                    </div>
                    {lastDeath.newBest && (
                      <p className="text-xs font-bold uppercase tracking-widest text-yellow-300 animate-pulse">
                        ★ New personal best ★
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center space-y-3">
                    <h2
                      className="text-3xl sm:text-4xl font-black tracking-widest"
                      style={{ fontFamily: '"Orbitron", sans-serif' }}
                    >
                      {GAME_NAME}
                    </h2>
                    <p className="text-white/50 text-sm max-w-sm">
                      Collect glowing orbs, outgrow rivals, and survive the void.
                    </p>
                    {bestScore > 0 && (
                      <p className="text-xs font-mono text-white/60">
                        Personal best: <span className="text-white">{bestScore}</span>
                      </p>
                    )}
                  </div>
                )}

                <div className="w-full space-y-2">
                  <label htmlFor="nickname" className="text-xs font-mono uppercase tracking-widest text-white/60">
                    Nickname
                  </label>
                  <input
                    id="nickname"
                    type="text"
                    maxLength={16}
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handlePlay()}
                    placeholder="Your snake name"
                    className="w-full px-4 py-3 rounded-xl bg-black/50 border border-white/15 text-white font-mono placeholder:text-white/25 focus:outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/30"
                  />
                </div>

                <div className="w-full space-y-2">
                  <span className="text-xs font-mono uppercase tracking-widest text-white/60">Color</span>
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Snake color">
                    <button
                      type="button"
                      aria-pressed={preferredColor === ''}
                      aria-label="Random color"
                      onClick={() => setPreferredColor('')}
                      className={`h-8 px-3 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${
                        preferredColor === ''
                          ? 'bg-white/25 text-white ring-2 ring-white/60'
                          : 'bg-white/10 text-white/70 hover:bg-white/15'
                      }`}
                    >
                      Auto
                    </button>
                    {NEON_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-pressed={preferredColor === color}
                        aria-label={COLOR_NAMES[color] ?? color}
                        title={COLOR_NAMES[color] ?? color}
                        onClick={() => setPreferredColor(color)}
                        className="h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-white/70"
                        style={{
                          backgroundColor: color,
                          boxShadow: preferredColor === color ? `0 0 0 2px #fff, 0 0 14px ${color}` : `0 0 8px ${color}66`,
                          transform: preferredColor === color ? 'scale(1.12)' : undefined,
                        }}
                      />
                    ))}
                  </div>
                </div>

                <button
                  onClick={handlePlay}
                  disabled={connectionStatus !== 'connected'}
                  className="w-full py-4 rounded-xl font-bold text-black transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: 'linear-gradient(90deg, #ff2d95, #00d4ff)',
                  }}
                >
                  {connectionStatus !== 'connected' ? 'Connecting...' : showDeath ? 'Respawn' : 'Play Now'}
                </button>

                <p className="text-[11px] text-white/70 font-mono text-center">
                  Hold A / D (or ← / →) to turn · SPACE to boost · boost burns length
                </p>
              </div>
            </motion.div>
          </motion.div>
      )}
    </div>
  );
}
