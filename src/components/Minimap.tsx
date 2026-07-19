import { useGameStore } from '../store/gameStore';
import { WORLD_SIZE } from '../shared/types';

export function Minimap() {
  const { gameState, playerId } = useGameStore();
  if (!gameState || !playerId) return null;

  const localPlayer = gameState.players[playerId];
  if (!localPlayer || localPlayer.state !== 'alive') return null;

  const head = localPlayer.segments[0];
  if (!head) return null;

  const size = 120;
  const half = WORLD_SIZE / 2;

  const toMap = (x: number, y: number) => ({
    left: ((x + half) / WORLD_SIZE) * size,
    top: ((half - y) / WORLD_SIZE) * size,
  });

  const playerPos = toMap(head.x, head.y);

  return (
    <div className="pointer-events-none absolute bottom-24 left-4 z-20 md:bottom-4">
      <div
        className="relative rounded-full border border-white/10 bg-black/40 backdrop-blur-md overflow-hidden"
        style={{ width: size, height: size }}
      >
        <div
          className="absolute inset-3 rounded-full border border-fuchsia-500/20"
          style={{ boxShadow: 'inset 0 0 20px rgba(255,45,149,0.08)' }}
        />

        {Object.values(gameState.players).map((player) => {
          if (player.state !== 'alive' || !player.segments[0]) return null;
          const pos = toMap(player.segments[0].x, player.segments[0].y);
          const isLocal = player.id === playerId;
          return (
            <div
              key={player.id}
              className="absolute rounded-full -translate-x-1/2 -translate-y-1/2"
              style={{
                left: pos.left,
                top: pos.top,
                width: isLocal ? 7 : 4,
                height: isLocal ? 7 : 4,
                backgroundColor: player.color,
                boxShadow: `0 0 ${isLocal ? 8 : 5}px ${player.color}`,
              }}
            />
          );
        })}

        <div
          className="absolute rounded-full border border-white/20 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: playerPos.left,
            top: playerPos.top,
            width: 20,
            height: 20,
          }}
        />
      </div>
    </div>
  );
}