import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ARENA_RADIUS, WORLD_SIZE } from '../shared/types';

export function Arena() {
  const ringRef = useRef<THREE.Mesh>(null);
  const half = WORLD_SIZE / 2;

  useFrame((state) => {
    if (!ringRef.current) return;
    const material = ringRef.current.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = 0.45 + Math.sin(state.clock.elapsedTime * 1.5) * 0.15;
  });

  return (
    <group>
      <mesh receiveShadow position={[0, 0, -0.3]}>
        <planeGeometry args={[WORLD_SIZE + 40, WORLD_SIZE + 40]} />
        <meshStandardMaterial color="#030308" roughness={1} metalness={0} />
      </mesh>

      <mesh ref={ringRef} position={[0, 0, -0.05]}>
        <ringGeometry args={[ARENA_RADIUS, half, 128]} />
        <meshStandardMaterial
          color="#ff2d95"
          emissive="#ff2d95"
          emissiveIntensity={0.45}
          transparent
          opacity={0.22}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}