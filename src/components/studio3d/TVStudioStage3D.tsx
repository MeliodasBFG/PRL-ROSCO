import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CameraShot,
  CharacterAnimationState,
  ContestantState,
  DEFAULT_AVATAR_CONFIGS,
  LetterState,
  PlayerScoreState,
  ROSCO_LETTERS,
  RoscoLetter,
} from '../../../shared/types';
import { ContestantAvatar3D } from './ContestantAvatar3D';
import { RoscoWheel3D } from './RoscoWheel3D';
import { Podium3D } from './Podium3D';

// ============================================================================
// CONTROLADOR DE CÁMARA 3D CON TRANSICIONES SUAVES Y COMPOSICIÓN RESPONSIVE
// ============================================================================

interface CameraControllerProps {
  cameraShot: CameraShot;
  isPodium: boolean;
}

const CameraController3D: React.FC<CameraControllerProps> = ({ cameraShot, isPodium }) => {
  const { camera, size } = useThree();
  const lookAtTarget = useRef(new THREE.Vector3(0, 0.22, 0));

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const aspect = size.width / Math.max(1, size.height);

    // En móviles o pantallas verticales alejamos ligeramente la cámara para que las 27 letras nunca se corten
    const responsiveZBoost = aspect < 0.75 ? 1.85 : aspect < 1.1 ? 0.95 : 0;

    let targetPos = new THREE.Vector3(0, 0.25, 5.75 + responsiveZBoost);
    let targetLook = new THREE.Vector3(0, 0.24, 0);

    if (isPodium || cameraShot === 'WINNER_PODIUM') {
      targetPos.set(Math.sin(t * 0.25) * 0.35, 0.15, 6.4 + responsiveZBoost);
      targetLook.set(0, -0.1, 0);
    } else {
      switch (cameraShot) {
        case 'CONTESTANT_ENTRY':
          targetPos.set(Math.sin(t * 0.4) * 0.18, 0.28, 5.55 + responsiveZBoost);
          targetLook.set(0, 0.25, 0);
          break;
        case 'ACTIVE_QUESTION':
          targetPos.set(Math.sin(t * 0.3) * 0.08, 0.26, 5.65 + responsiveZBoost);
          targetLook.set(0, 0.25, 0);
          break;
        case 'CELEBRATION':
          targetPos.set(Math.sin(t * 1.2) * 0.16, 0.3, 5.45 + responsiveZBoost);
          targetLook.set(0, 0.28, 0);
          break;
        case 'TURN_END':
          targetPos.set(0, 0.24, 5.9 + responsiveZBoost);
          targetLook.set(0, 0.22, 0);
          break;
      }
    }

    camera.position.lerp(targetPos, 0.07);
    lookAtTarget.current.lerp(targetLook, 0.09);
    camera.lookAt(lookAtTarget.current);
  });

  return null;
};

// ============================================================================
// ESCENOGRAFÍA DEL PLATÓ DE TELEVISIÓN 3D (LUCES, ANILLOS Y FONDO AZUL)
// ============================================================================

const StudioBackdrop3D: React.FC = () => {
  const ringsRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (ringsRef.current) {
      ringsRef.current.rotation.z = t * 0.04;
    }
  });

  return (
    <group>
      {/* Pared curva de plató azul profundo */}
      <mesh position={[0, 0.2, -3.4]} receiveShadow>
        <planeGeometry args={[22, 14]} />
        <meshStandardMaterial color="#0044cc" roughness={0.65} metalness={0.1} />
      </mesh>

      {/* Halo central luminoso de plató detrás del concursante (idéntico al fondo azul brillante de TV) */}
      <mesh position={[0, 0.3, -2.5]}>
        <circleGeometry args={[3.4, 48]} />
        <meshBasicMaterial color="#0077ff" transparent opacity={0.42} />
      </mesh>
      <mesh position={[0, 0.3, -2.2]}>
        <circleGeometry args={[2.1, 48]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} />
      </mesh>

      {/* Anillos decorativos sutiles de plató televisivo en el fondo */}
      <group ref={ringsRef} position={[0, 0.28, -2.0]}>
        <mesh position={[-2.9, -0.6, -0.4]}>
          <ringGeometry args={[0.85, 1.18, 40]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.35} />
        </mesh>
        <mesh position={[3.1, 0.7, -0.4]}>
          <ringGeometry args={[0.95, 1.3, 40]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.35} />
        </mesh>
        <mesh position={[0, 0, -0.2]}>
          <ringGeometry args={[2.95, 3.05, 64]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.22} />
        </mesh>
      </group>

      {/* Haces de iluminación volumétrica de plató */}
      <mesh position={[-3.2, 3.4, -1.6]} rotation={[0, 0, 0.42]}>
        <coneGeometry args={[1.6, 7.5, 24, 1, true]} />
        <meshBasicMaterial
          color="#60a5fa"
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[3.2, 3.4, -1.6]} rotation={[0, 0, -0.42]}>
        <coneGeometry args={[1.6, 7.5, 24, 1, true]} />
        <meshBasicMaterial
          color="#60a5fa"
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Suelo reflectante del plató */}
      <mesh position={[0, -2.15, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[8.5, 48]} />
        <meshStandardMaterial color="#031852" roughness={0.25} metalness={0.55} />
      </mesh>
    </group>
  );
};

// ============================================================================
// ALTERNATIVA 2D SI WEBGL NO ESTÁ DISPONIBLE (SECCIÓN 19)
// ============================================================================

export const Studio2DFallback: React.FC<{
  activeContestant: ContestantState | null;
  activeLetter: RoscoLetter | null;
}> = ({ activeContestant, activeLetter }) => {
  const letters = activeContestant?.letters;
  return (
    <div
      data-testid="rosco-2d-fallback"
      className="relative w-full h-full min-h-[380px] flex items-center justify-center bg-gradient-to-b from-[#0055ff] via-[#003bb5] to-[#021447] overflow-hidden select-none"
    >
      <div className="relative w-[330px] h-[330px] sm:w-[430px] sm:h-[430px] flex items-center justify-center">
        {ROSCO_LETTERS.map((letter, idx) => {
          const angle = Math.PI / 2 - (idx * 2 * Math.PI) / ROSCO_LETTERS.length;
          const r = 43; // porcentaje
          const left = 50 + Math.cos(angle) * r;
          const top = 50 - Math.sin(angle) * r;
          const st: LetterState = letters?.[letter]?.state ?? 'UNSEEN';
          const isAct = activeLetter === letter || st === 'ACTIVE';

          let bgClass = 'bg-slate-700/90 border-blue-300/60';
          if (isAct) bgClass = 'bg-blue-600 border-white scale-125 shadow-rosco-blue z-20';
          else if (st === 'CORRECT') bgClass = 'bg-emerald-500 border-emerald-200 shadow-rosco-green';
          else if (st === 'INCORRECT') bgClass = 'bg-red-600 border-red-200 shadow-rosco-red';
          else if (st === 'PASSED') bgClass = 'bg-amber-500 border-amber-200 shadow-rosco-amber';

          return (
            <div
              key={letter}
              style={{ left: `${left}%`, top: `${top}%` }}
              className={`-translate-x-1/2 -translate-y-1/2 absolute w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 flex items-center justify-center font-display font-extrabold text-sm sm:text-base text-white transition-all duration-300 ${bgClass}`}
            >
              {letter}
            </div>
          );
        })}

        {/* Avatar central 2D estilizado de respaldo */}
        <div className="flex flex-col items-center justify-center text-center z-10">
          <div
            className="w-28 h-28 sm:w-36 sm:h-36 rounded-full border-4 border-white/40 shadow-2xl flex flex-col items-center justify-end overflow-hidden"
            style={{ backgroundColor: activeContestant?.avatar.outfitColor || '#2ce5c4' }}
          >
            <div
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full mb-1 border-2 border-black/10"
              style={{ backgroundColor: activeContestant?.avatar.skinColor || '#ecc09e' }}
            />
            <div className="w-24 h-10 rounded-t-2xl bg-black/15 flex items-center justify-center">
              <span className="px-2 py-0.5 rounded-full bg-amber-600 text-[10px] font-bold text-white">
                {activeContestant?.name || 'PLATÓ PRL'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

class WebGLErrorBoundary extends Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: React.ReactNode; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function detectWebGLSupport(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch {
    return false;
  }
}

// ============================================================================
// COMPONENTE PRINCIPAL DEL ESCENARIO 3D TELEVISIVO
// ============================================================================

export interface TVStudioStage3DProps {
  activeContestant: ContestantState | null;
  activeLetter: RoscoLetter | null;
  characterAnimation: CharacterAnimationState;
  cameraShot: CameraShot;
  isGameFinished?: boolean;
  allContestants?: ContestantState[];
  leaderboard?: PlayerScoreState[];
  force2DFallback?: boolean;
}

export const TVStudioStage3D: React.FC<TVStudioStage3DProps> = ({
  activeContestant,
  activeLetter,
  characterAnimation,
  cameraShot,
  isGameFinished = false,
  allContestants = [],
  leaderboard = [],
  force2DFallback = false,
}) => {
  const [webglAvailable, setWebglAvailable] = useState(true);

  useEffect(() => {
    setWebglAvailable(detectWebGLSupport());
  }, []);

  const isRoscoCompleteGold = useMemo(() => {
    if (!activeContestant) return false;
    return (
      activeContestant.score.pendingCount === 0 && activeContestant.score.correctCount === 27
    );
  }, [activeContestant]);

  const fallbackNode = (
    <Studio2DFallback activeContestant={activeContestant} activeLetter={activeLetter} />
  );

  if (!webglAvailable || force2DFallback) {
    return fallbackNode;
  }

  const avatarConfig = activeContestant?.avatar ?? DEFAULT_AVATAR_CONFIGS[0];
  const avatarName = activeContestant?.name ?? 'PRL-ROSCO';

  return (
    <WebGLErrorBoundary fallback={fallbackNode}>
      <div
        data-testid="tv-studio-stage-3d"
        className="relative w-full h-full min-h-[360px] bg-gradient-to-b from-[#0055ff] via-[#003bb5] to-[#021447] overflow-hidden"
      >
        <Canvas
          shadows
          dpr={[1, 1.75]}
          camera={{ position: [0, 0.25, 5.75], fov: 44, near: 0.1, far: 50 }}
        >
          <color attach="background" args={['#0042c4']} />
          <fog attach="fog" args={['#0036a3', 9, 22]} />

          {/* Iluminación de plató televisivo profesional */}
          <ambientLight intensity={0.85} color="#dbeafe" />
          <directionalLight
            position={[2.5, 4.5, 5]}
            intensity={1.45}
            color="#ffffff"
            castShadow
          />
          <directionalLight position={[-3.5, 2.5, 3]} intensity={0.75} color="#60a5fa" />
          <pointLight position={[0, 1.2, 2.5]} intensity={0.85} color="#93c5fd" />
          <spotLight
            position={[0, 5.5, 2]}
            angle={0.55}
            penumbra={0.8}
            intensity={1.3}
            color="#e0f2fe"
          />

          <CameraController3D cameraShot={cameraShot} isPodium={isGameFinished} />
          <StudioBackdrop3D />

          {isGameFinished && leaderboard.length > 0 ? (
            <Podium3D contestants={allContestants} leaderboard={leaderboard} />
          ) : (
            <group>
              {/* Personaje humano 3D en el centro del rosco */}
              <ContestantAvatar3D
                name={avatarName}
                avatar={avatarConfig}
                animationState={characterAnimation}
                position={[0, -0.58, 0]}
                scale={1.08}
                showBadge={true}
              />

              {/* Rosco circular 3D de 27 letras rodeando al personaje */}
              <RoscoWheel3D
                letters={activeContestant?.letters ?? null}
                activeLetter={activeLetter}
                isRoscoCompleteGold={isRoscoCompleteGold}
                radius={2.15}
                centerY={0.28}
              />
            </group>
          )}
        </Canvas>
      </div>
    </WebGLErrorBoundary>
  );
};
