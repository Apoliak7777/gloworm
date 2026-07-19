import { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { GameScene } from './components/GameScene';
import { useGameStore } from './store/gameStore';
import { UI } from './components/UI';

export default function App() {
  const { connect } = useGameStore();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div className="w-screen h-screen bg-[#030308] overflow-hidden relative select-none">
      <Canvas
        shadows
        camera={{ position: [0, 0, 50], fov: 55 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={[1, 1.5]}
      >
        <color attach="background" args={['#030308']} />
        <fog attach="fog" args={['#030308', 100, 200]} />
        <GameScene />
        <EffectComposer>
          <Bloom luminanceThreshold={0.8} mipmapBlur intensity={1.8} radius={0.6} />
          <Vignette offset={0.2} darkness={0.7} />
        </EffectComposer>
      </Canvas>
      <UI />
    </div>
  );
}