import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { globalGameState } from '../store/gameStore';
import { localPlayerView } from '../store/localPlayerView';
import { shortestArc, smoothing } from '../shared/gameLogic';
import { SNAKE_INSTANCE_CAP } from '../shared/types';

/** How quickly remote snakes' bodies and heads catch up to server state. */
const REMOTE_FOLLOW_RATE = 14;
const REMOTE_ANGLE_RATE = 12;

const emissiveBodyShader = (intensity: number) => (shader: THREE.WebGLProgramParametersWithUniforms) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `
    #include <emissivemap_fragment>
    float fresnel = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 2.0);
    totalEmissiveRadiance += diffuseColor.rgb * (${intensity} + fresnel * 2.5);
    `,
  );
};

/** Shortest-arc angle interpolation so remote heads turn smoothly. */
function lerpAngle(current: number, target: number, t: number): number {
  return current + shortestArc(target - current) * Math.min(1, t);
}

export function Snake({
  playerId,
  color,
  name,
  isLocal,
}: {
  playerId: string;
  color: string;
  name: string;
  isLocal: boolean;
}) {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headGroupRef = useRef<THREE.Group>(null);
  const headPivotRef = useRef<THREE.Group>(null);
  const headMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const positions = useRef<{ x: number; y: number }[]>([]);
  const displayAngle = useRef(0);
  const angleInitialized = useRef(false);

  useFrame((_state, delta) => {
    if (!bodyRef.current || !headGroupRef.current || !headPivotRef.current) return;
    const gs = globalGameState.current;
    if (!gs) return;

    const serverPlayer = gs.players[playerId];

    // The local snake renders straight from the local simulation — the shared
    // server snapshot is lagged and rounded, and reading it here caused a
    // 20 Hz stutter. Everyone else comes from server state and is interpolated.
    const fromLocalSim = isLocal && localPlayerView.active && localPlayerView.segments.length > 0;
    const segments = fromLocalSim ? localPlayerView.segments : serverPlayer?.segments;
    const sourceAngle = fromLocalSim ? localPlayerView.angle : serverPlayer?.currentAngle ?? 0;
    const boosting = fromLocalSim ? localPlayerView.isBoosting : serverPlayer?.isBoosting ?? false;

    if (!segments || segments.length === 0) {
      bodyRef.current.count = 0;
      headGroupRef.current.visible = false;
      return;
    }

    headGroupRef.current.visible = true;
    const count = Math.min(segments.length, SNAKE_INSTANCE_CAP);
    bodyRef.current.count = Math.max(0, count - 1);

    // Drop stale trailing entries when the snake shrinks (boost burn); the
    // while-loop below then re-seeds fresh positions at the exact targets.
    if (positions.current.length > count) positions.current.length = count;
    while (positions.current.length < count) {
      const idx = positions.current.length;
      positions.current.push({
        x: segments[idx]?.x ?? 0,
        y: segments[idx]?.y ?? 0,
      });
    }

    // Exponential smoothing is frame-rate independent, unlike `k * delta`.
    const follow = smoothing(REMOTE_FOLLOW_RATE, delta);
    const angleFollow = smoothing(REMOTE_ANGLE_RATE, delta);

    for (let i = 0; i < count; i++) {
      const target = segments[i];
      const curr = positions.current[i];

      if (fromLocalSim) {
        curr.x = target.x;
        curr.y = target.y;
      } else {
        const dist = Math.abs(target.x - curr.x) + Math.abs(target.y - curr.y);
        if (dist > 12) {
          curr.x = target.x;
          curr.y = target.y;
        } else {
          curr.x += (target.x - curr.x) * follow;
          curr.y += (target.y - curr.y) * follow;
        }
      }

      if (i === 0) {
        headGroupRef.current.position.set(curr.x, curr.y, 0.6);
        headGroupRef.current.scale.setScalar(boosting ? 1.15 : 1);
        if (fromLocalSim || !angleInitialized.current) {
          // Seed the angle on first appearance so remote heads don't spin up
          // from 0; after that, ease remote heads toward the reported angle.
          displayAngle.current = sourceAngle;
          angleInitialized.current = true;
        } else {
          displayAngle.current = lerpAngle(displayAngle.current, sourceAngle, angleFollow);
        }
        headPivotRef.current.rotation.z = displayAngle.current;
        if (headMatRef.current) {
          headMatRef.current.emissiveIntensity = boosting ? 1.1 : 0.5;
        }
      } else {
        const scale = 1 - Math.min(i / count, 1) * 0.25;
        dummy.position.set(curr.x, curr.y, 0.5);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        bodyRef.current.setMatrixAt(i - 1, dummy.matrix);
      }
    }

    // Upload only the instances actually written. Without an update range,
    // three re-uploads the whole SNAKE_INSTANCE_CAP-sized buffer every frame
    // (`count` gates drawing, not the upload) — megabytes per frame of which
    // a few percent is real data. clearUpdateRanges() first, or ranges pile up.
    const written = Math.max(0, count - 1);
    bodyRef.current.instanceMatrix.clearUpdateRanges();
    bodyRef.current.instanceMatrix.addUpdateRange(0, written * 16);
    bodyRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <group ref={headGroupRef}>
        <group ref={headPivotRef}>
          <mesh castShadow receiveShadow>
            <sphereGeometry args={[0.8, 20, 20]} />
            <meshStandardMaterial
              ref={headMatRef}
              color={color}
              emissive={color}
              emissiveIntensity={0.5}
              roughness={0.15}
              metalness={0.85}
              toneMapped={false}
              onBeforeCompile={emissiveBodyShader(0.5)}
            />
          </mesh>

          {/* Eyes looking along the movement direction */}
          <mesh position={[0.42, 0.34, 0.38]}>
            <sphereGeometry args={[0.24, 12, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.35} roughness={0.25} />
          </mesh>
          <mesh position={[0.42, -0.34, 0.38]}>
            <sphereGeometry args={[0.24, 12, 12]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.35} roughness={0.25} />
          </mesh>
          <mesh position={[0.62, 0.36, 0.44]}>
            <sphereGeometry args={[0.11, 10, 10]} />
            <meshStandardMaterial color="#0a0a12" roughness={0.4} />
          </mesh>
          <mesh position={[0.62, -0.36, 0.44]}>
            <sphereGeometry args={[0.11, 10, 10]} />
            <meshStandardMaterial color="#0a0a12" roughness={0.4} />
          </mesh>
        </group>

        <Html position={[0, 1.6, 0]} center distanceFactor={20} style={{ pointerEvents: 'none' }}>
          <div
            className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
            style={{
              color,
              background: 'rgba(0,0,0,0.6)',
              border: `1px solid ${color}`,
              textShadow: `0 0 8px ${color}`,
              opacity: isLocal ? 1 : 0.85,
            }}
          >
            {name}
          </div>
        </Html>
      </group>

      <instancedMesh ref={bodyRef} args={[null as never, null as never, SNAKE_INSTANCE_CAP]} castShadow receiveShadow frustumCulled={false}>
        <sphereGeometry args={[0.6, 14, 14]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          roughness={0.2}
          metalness={0.8}
          toneMapped={false}
          onBeforeCompile={emissiveBodyShader(0.35)}
        />
      </instancedMesh>
    </group>
  );
}
