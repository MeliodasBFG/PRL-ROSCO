import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { ContestantState, PlayerScoreState } from '../../../shared/types';
import { ContestantAvatar3D } from './ContestantAvatar3D';

interface Podium3DProps {
  contestants: ContestantState[];
  leaderboard: PlayerScoreState[];
}

const CONFETTI_COLORS = ['#fbbf24', '#38bdf8', '#34d399', '#f43f5e', '#a78bfa', '#ffffff'];

const ConfettiParticles3D: React.FC = () => {
  const groupRef = useRef<THREE.Group>(null);

  const particles = useMemo(() => {
    return Array.from({ length: 85 }).map((_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 8.5,
      y: Math.random() * 6 - 1,
      z: (Math.random() - 0.5) * 3.5,
      speedY: 0.7 + Math.random() * 1.1,
      rotSpeed: 1.5 + Math.random() * 3,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    }));
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.children.forEach((child, i) => {
      const p = particles[i];
      if (!p) return;
      child.position.y -= p.speedY * delta;
      child.rotation.x += p.rotSpeed * delta;
      child.rotation.y += p.rotSpeed * 0.8 * delta;
      if (child.position.y < -2.3) {
        child.position.y = 4.2;
      }
    });
  });

  return (
    <group ref={groupRef}>
      {particles.map((p) => (
        <mesh key={p.id} position={[p.x, p.y, p.z]}>
          <planeGeometry args={[0.09, 0.14]} />
          <meshBasicMaterial color={p.color} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
};

/**
 * Podio 3D de clasificación final con 1.º, 2.º y 3.er puesto, avatares 3D, puntuaciones y confeti.
 */
export const Podium3D: React.FC<Podium3DProps> = ({ contestants, leaderboard }) => {
  const podiumEntries = useMemo(() => {
    const map = new Map(contestants.map((c) => [c.id, c]));
    return leaderboard
      .slice(0, 3)
      .map((score, idx) => {
        const c = map.get(score.playerId);
        return c ? { rank: idx + 1, contestant: c, score } : null;
      })
      .filter(Boolean) as Array<{
      rank: number;
      contestant: ContestantState;
      score: PlayerScoreState;
    }>;
  }, [contestants, leaderboard]);

  const slots = [
    {
      rank: 1,
      x: 0,
      height: 1.35,
      color: '#eab308',
      rim: '#fef08a',
      label: '1º',
    },
    {
      rank: 2,
      x: -2.05,
      height: 0.98,
      color: '#94a3b8',
      rim: '#f1f5f9',
      label: '2º',
    },
    {
      rank: 3,
      x: 2.05,
      height: 0.72,
      color: '#d97706',
      rim: '#fed7aa',
      label: '3º',
    },
  ];

  return (
    <group position={[0, -0.7, 0]}>
      <ConfettiParticles3D />

      {slots.map((slot) => {
        const entry = podiumEntries.find((e) => e.rank === slot.rank);
        const pedestalY = -1.35 + slot.height / 2;
        const avatarBaseY = -1.35 + slot.height + 0.52;

        return (
          <group key={slot.rank} position={[slot.x, 0, 0]}>
            {/* Pedestal cilíndrico 3D iluminado */}
            <mesh position={[0, pedestalY, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.76, 0.84, slot.height, 36]} />
              <meshStandardMaterial
                color={slot.color}
                roughness={0.25}
                metalness={0.45}
                emissive={slot.color}
                emissiveIntensity={0.22}
              />
            </mesh>

            {/* Anillo superior luminoso */}
            <mesh position={[0, -1.35 + slot.height, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.76, 0.028, 14, 36]} />
              <meshBasicMaterial color={slot.rim} />
            </mesh>

            {/* Número de puesto en el frontal del pedestal */}
            <Text
              position={[0, pedestalY + 0.08, 0.83]}
              fontSize={0.34}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.018}
              outlineColor="#020b24"
            >
              {slot.label}
            </Text>

            {entry && (
              <>
                <ContestantAvatar3D
                  name={entry.contestant.name}
                  avatar={entry.contestant.avatar}
                  animationState={slot.rank === 1 ? 'FINAL_VICTORY' : 'CELEBRATE_CORRECT'}
                  position={[0, avatarBaseY, 0]}
                  scale={0.78}
                  showBadge={true}
                />

                {/* Tarjeta 3D con nombre y puntuación */}
                <Text
                  position={[0, pedestalY - 0.24, 0.85]}
                  fontSize={0.15}
                  color="#fde047"
                  anchorX="center"
                  anchorY="middle"
                  outlineWidth={0.01}
                  outlineColor="#020b24"
                >
                  {`${entry.score.totalPoints} pts (${entry.score.correctCount}✓)`}
                </Text>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
};
