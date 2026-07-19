import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const PARTICLE_COUNT = 60;
const LIFETIME = 1.1;

export type Burst = { id: number; x: number; y: number; color: string };

/** One-shot neon particle explosion shown where a snake died. */
export function DeathBurst({ burst, onDone }: { burst: Burst; onDone: (id: number) => void }) {
  const pointsRef = useRef<THREE.Points>(null);
  const age = useRef(0);
  const done = useRef(false);

  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = burst.x;
      positions[i * 3 + 1] = burst.y;
      positions[i * 3 + 2] = 0.6;
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 14;
      velocities[i * 3] = Math.cos(angle) * speed;
      velocities[i * 3 + 1] = Math.sin(angle) * speed;
      velocities[i * 3 + 2] = 1 + Math.random() * 3;
    }
    return { positions, velocities };
  }, [burst]);

  useFrame((_state, delta) => {
    if (done.current || !pointsRef.current) return;
    age.current += delta;

    if (age.current >= LIFETIME) {
      done.current = true;
      onDone(burst.id);
      return;
    }

    const attr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const drag = Math.pow(0.2, delta);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      velocities[i * 3] *= drag;
      velocities[i * 3 + 1] *= drag;
      arr[i * 3] += velocities[i * 3] * delta;
      arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
    }
    attr.needsUpdate = true;

    const material = pointsRef.current.material as THREE.PointsMaterial;
    material.opacity = Math.max(0, 1 - age.current / LIFETIME);
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.5}
        color={burst.color}
        transparent
        opacity={1}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
