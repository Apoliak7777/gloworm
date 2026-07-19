import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalGameState } from '../store/gameStore';
import { ORB_INSTANCE_CAP } from '../shared/types';

export const localCollectedOrbs = new Set<string>();

export function Orbs() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const gs = globalGameState.current;
    if (!gs) return;

    const pulse = 1 + Math.sin(state.clock.elapsedTime * 4) * 0.12;
    let i = 0;

    for (const orbId in gs.orbs) {
      if (i >= ORB_INSTANCE_CAP) break;
      if (localCollectedOrbs.has(orbId)) continue;
      const orb = gs.orbs[orbId];
      const wobble = Math.sin(state.clock.elapsedTime * 3 + orb.x) * 0.08;
      dummy.position.set(orb.x, orb.y, 0.5 + wobble);
      dummy.scale.setScalar(pulse * (0.8 + orb.value * 0.15));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      colorObj.set(orb.color);
      meshRef.current.setColorAt(i, colorObj);
      i++;
    }

    meshRef.current.count = i;
    // Only upload the instances written this frame — see the note in Snake.tsx.
    meshRef.current.instanceMatrix.clearUpdateRanges();
    meshRef.current.instanceMatrix.addUpdateRange(0, i * 16);
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.clearUpdateRanges();
      meshRef.current.instanceColor.addUpdateRange(0, i * 3);
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[null as never, null as never, ORB_INSTANCE_CAP]} castShadow receiveShadow frustumCulled={false}>
      <sphereGeometry args={[0.5, 12, 12]} />
      <meshStandardMaterial
        roughness={0.3}
        metalness={0.2}
        toneMapped={false}
        onBeforeCompile={(shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
            #include <emissivemap_fragment>
            totalEmissiveRadiance += diffuseColor.rgb * 3.0;
            `,
          );
        }}
      />
    </instancedMesh>
  );
}