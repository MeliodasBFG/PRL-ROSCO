import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  LetterState,
  PlayerLetterProgress,
  ROSCO_LETTERS,
  RoscoLetter,
} from '../../../shared/types';

interface RoscoWheel3DProps {
  letters: Record<RoscoLetter, PlayerLetterProgress> | null;
  activeLetter: RoscoLetter | null;
  isRoscoCompleteGold?: boolean;
  radius?: number;
  centerY?: number;
}

interface LetterVisualStyle {
  fill: string;
  emissive: string;
  emissiveIntensity: number;
  rimColor: string;
}

function getLetterVisualStyle(
  state: LetterState,
  isActive: boolean,
  isCompleteGold: boolean
): LetterVisualStyle {
  if (isCompleteGold && state === 'CORRECT') {
    return {
      fill: '#f59e0b',
      emissive: '#fbbf24',
      emissiveIntensity: 0.9,
      rimColor: '#fef08a',
    };
  }

  if (isActive || state === 'ACTIVE') {
    // Azul eléctrico luminoso de pregunta activa (como las letras U, M, G en la referencia)
    return {
      fill: '#0055ff',
      emissive: '#1d75ff',
      emissiveIntensity: 1.05,
      rimColor: '#bae6fd',
    };
  }

  switch (state) {
    case 'CORRECT':
      // Verde esmeralda intenso luminoso (como las letras acertadas en la referencia)
      return {
        fill: '#0fb84b',
        emissive: '#10b981',
        emissiveIntensity: 0.65,
        rimColor: '#a7f3d0',
      };
    case 'INCORRECT':
      // Rojo intenso de fallo
      return {
        fill: '#dc2626',
        emissive: '#ef4444',
        emissiveIntensity: 0.7,
        rimColor: '#fecaca',
      };
    case 'PASSED':
      // Amarillo / Naranja de Pasapalabra pendiente
      return {
        fill: '#d97706',
        emissive: '#f59e0b',
        emissiveIntensity: 0.72,
        rimColor: '#fde68a',
      };
    case 'UNSEEN':
    default:
      // Azul-grisáceo metálico de letra todavía no realizada
      return {
        fill: '#1e3a6e',
        emissive: '#0f2554',
        emissiveIntensity: 0.32,
        rimColor: '#93c5fd',
      };
  }
}

interface SingleRoscoSphereProps {
  letter: RoscoLetter;
  state: LetterState;
  isActive: boolean;
  isCompleteGold: boolean;
  position: [number, number, number];
}

const SingleRoscoSphere3D: React.FC<SingleRoscoSphereProps> = ({
  letter,
  state,
  isActive,
  isCompleteGold,
  position,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const prevStateRef = useRef<LetterState>(state);
  const stateChangeTimeRef = useRef(0);

  if (prevStateRef.current !== state) {
    prevStateRef.current = state;
    stateChangeTimeRef.current = 0;
  }

  const style = useMemo(
    () => getLetterVisualStyle(state, isActive, isCompleteGold),
    [state, isActive, isCompleteGold]
  );

  useFrame((clockState, delta) => {
    if (!groupRef.current) return;
    const t = clockState.clock.getElapsedTime();
    stateChangeTimeRef.current += delta;
    const elapsed = stateChangeTimeRef.current;

    // Escala base y pulso cuando la letra está activa
    let targetScale = 1;
    let offsetX = 0;
    let offsetZ = 0;

    if (isActive || state === 'ACTIVE') {
      targetScale = 1.24 + Math.sin(t * 5.5) * 0.06;
      offsetZ = 0.14;
    } else if (state === 'CORRECT' && elapsed < 0.7) {
      // Animación positiva al marcar acierto
      targetScale = 1 + Math.sin(elapsed * Math.PI * 1.4) * 0.28;
    } else if (state === 'INCORRECT' && elapsed < 0.6) {
      // Sacudida de fallo al marcar error
      offsetX = Math.sin(elapsed * 38) * 0.07 * (1 - elapsed);
    } else if (state === 'PASSED' && elapsed < 0.6) {
      // Giro suave al marcar Pasapalabra
      targetScale = 1.1;
    }

    const currentScale = groupRef.current.scale.x;
    const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.18);
    groupRef.current.scale.setScalar(nextScale);

    groupRef.current.position.x = THREE.MathUtils.lerp(
      groupRef.current.position.x,
      position[0] + offsetX,
      0.22
    );
    groupRef.current.position.y = position[1];
    groupRef.current.position.z = THREE.MathUtils.lerp(
      groupRef.current.position.z,
      position[2] + offsetZ,
      0.18
    );

    if (haloRef.current) {
      const pulse = 1 + Math.sin(t * 6) * 0.12;
      haloRef.current.scale.setScalar(pulse);
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Esfera tridimensional luminosa de la letra */}
      <mesh castShadow>
        <sphereGeometry args={[0.205, 28, 28]} />
        <meshStandardMaterial
          color={style.fill}
          emissive={style.emissive}
          emissiveIntensity={style.emissiveIntensity}
          roughness={0.2}
          metalness={0.25}
        />
      </mesh>

      {/* Aro biselado luminoso exterior (idéntico al borde brillante del rosco de TV) */}
      <mesh position={[0, 0, 0.03]}>
        <torusGeometry args={[0.205, 0.018, 14, 36]} />
        <meshBasicMaterial color={style.rimColor} />
      </mesh>

      {/* Resplandor / Halo adicional cuando la letra está activa */}
      {(isActive || state === 'ACTIVE') && (
        <mesh ref={haloRef} position={[0, 0, -0.03]}>
          <ringGeometry args={[0.22, 0.31, 32]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.65} />
        </mesh>
      )}

      {/* Letra en blanco puro de alta legibilidad */}
      <Text
        position={[0, 0.005, 0.215]}
        fontSize={letter === 'Ñ' ? 0.195 : 0.21}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="#020b24"
      >
        {letter}
      </Text>
    </group>
  );
};

/**
 * Rosco circular 3D de 27 letras (A-Z incluyendo Ñ) que rodea al avatar central.
 * Distribución circular matemáticamente uniforme: A en las 12 en punto, sentido horario.
 */
export const RoscoWheel3D: React.FC<RoscoWheel3DProps> = ({
  letters,
  activeLetter,
  isRoscoCompleteGold = false,
  radius = 2.15,
  centerY = 0,
}) => {
  const nodes = useMemo(() => {
    const total = ROSCO_LETTERS.length; // 27 letras exactas
    return ROSCO_LETTERS.map((letter, idx) => {
      // Ángulo: A (idx=0) arriba en 90° (PI/2), avanzando en sentido horario
      const angle = Math.PI / 2 - (idx * 2 * Math.PI) / total;
      const x = Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      return {
        letter,
        position: [x, y, 0.15] as [number, number, number],
      };
    });
  }, [radius, centerY]);

  return (
    <group>
      {/* Aro guía sutil traslúcido que conecta las 27 esferas del rosco */}
      <mesh position={[0, centerY, 0.05]}>
        <torusGeometry args={[radius, 0.014, 12, 96]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.28} />
      </mesh>

      {nodes.map((node) => {
        const progress = letters?.[node.letter];
        const state: LetterState = progress?.state ?? 'UNSEEN';
        const isActive = activeLetter === node.letter || state === 'ACTIVE';

        return (
          <SingleRoscoSphere3D
            key={node.letter}
            letter={node.letter}
            state={state}
            isActive={isActive}
            isCompleteGold={isRoscoCompleteGold}
            position={node.position}
          />
        );
      })}
    </group>
  );
};
