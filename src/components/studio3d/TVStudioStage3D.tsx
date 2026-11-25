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
// CÁLCULO MATEMÁTICO RESPONSIVE DE CÁMARA Y ROSCO 3D (CERO RECORTES)
// ============================================================================

export interface ResponsiveStageMetrics {
  width: number;
  height: number;
  aspect: number;
  fovDeg: number;
  cameraZ: number;
  projectedRoscoDiameterPx: number;
  sideWingPx: number;
  canShowCornerHud: boolean;
}

export const ROSCO_WORLD_RADIUS = 2.15;
export const ROSCO_OUTER_RADIUS = 2.51; // Radio 2.15 + esfera activa/halo exterior 0.36
export const ROSCO_FRONT_Z = 0.40;
export const ROSCO_CAMERA_FOV = 44;

export function computeResponsiveStageMetrics(
  rawWidth: number,
  rawHeight: number,
  options?: { isPodium?: boolean; fovDeg?: number }
): ResponsiveStageMetrics {
  const width = Math.max(160, rawWidth || 800);
  const height = Math.max(160, rawHeight || 480);
  const aspect = width / height;
  const fovDeg = options?.fovDeg ?? ROSCO_CAMERA_FOV;
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360);

  const isPodium = Boolean(options?.isPodium);
  const maxCameraSway = 0.06;
  const boundingHalfW = (isPodium ? 3.25 : ROSCO_OUTER_RADIUS) + maxCameraSway;
  const boundingHalfH = (isPodium ? 2.35 : ROSCO_OUTER_RADIUS) + maxCameraSway;

  // Dejamos margen de seguridad (12% en escritorio apaisado, 15% en móvil/vertical/cuadrado)
  const fillRatio = aspect >= 1.25 ? 0.88 : 0.85;

  const distVertical = boundingHalfH / fillRatio / tanHalfFov;
  const distHorizontal = boundingHalfW / fillRatio / (tanHalfFov * Math.max(0.25, aspect));
  const requiredDistance = Math.max(distVertical, distHorizontal);

  const zFront = isPodium ? 0.85 : ROSCO_FRONT_Z;
  const cameraZ = zFront + requiredDistance;

  // Tamaño proyectado real del rosco en píxeles para saber si los laterales están libres para el HUD
  const distToRim = cameraZ - 0.18;
  const visibleHalfH = distToRim * tanHalfFov;
  const projectedRoscoDiameterPx = (ROSCO_OUTER_RADIUS / visibleHalfH) * height;
  const sideWingPx = Math.max(0, (width - projectedRoscoDiameterPx) / 2);

  // Solo flotamos el HUD en las esquinas si hay al menos 175px libres a cada lado fuera del círculo
  const canShowCornerHud = !isPodium && sideWingPx >= 175 && height >= 200;

  return {
    width,
    height,
    aspect,
    fovDeg,
    cameraZ,
    projectedRoscoDiameterPx,
    sideWingPx,
    canShowCornerHud,
  };
}

// ============================================================================
// CONTROLADOR DE CÁMARA 3D ADAPTADO AL CONTENEDOR Y ORIENTACIÓN
// ============================================================================

interface CameraControllerProps {
  cameraShot: CameraShot;
  isPodium: boolean;
  metrics: ResponsiveStageMetrics;
}

const CameraController3D: React.FC<CameraControllerProps> = ({
  cameraShot,
  isPodium,
  metrics,
}) => {
  const { camera, gl, size } = useThree();
  const lookAtTarget = useRef(new THREE.Vector3(0, 0, 0));
  const initializedRef = useRef(false);
  const lastCameraZRef = useRef(metrics.cameraZ);

  // Sincronizar aspect ratio, proyección y pixelRatio ante cambios de tamaño, orientación o zoom
  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    const effectiveW = Math.max(1, size.width || metrics.width);
    const effectiveH = Math.max(1, size.height || metrics.height);
    const targetAspect = effectiveW / effectiveH;

    if (Math.abs(persp.aspect - targetAspect) > 0.0005) {
      persp.aspect = targetAspect;
      persp.updateProjectionMatrix();
    }
    if (persp.fov !== metrics.fovDeg) {
      persp.fov = metrics.fovDeg;
      persp.updateProjectionMatrix();
    }
    if (typeof window !== 'undefined') {
      gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
  }, [camera, gl, size.width, size.height, metrics.width, metrics.height, metrics.fovDeg]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    const persp = camera as THREE.PerspectiveCamera;
    const liveAspect = Math.max(1, size.width) / Math.max(1, size.height);
    if (Math.abs(persp.aspect - liveAspect) > 0.001) {
      persp.aspect = liveAspect;
      persp.updateProjectionMatrix();
    }

    const baseZ = metrics.cameraZ;
    let swayX = 0;
    let swayY = 0;
    let extraZ = 0;
    let lookY = isPodium ? -0.05 : 0;

    if (isPodium || cameraShot === 'WINNER_PODIUM') {
      swayX = Math.sin(t * 0.25) * 0.14;
      swayY = 0.08;
      extraZ = 0.15;
    } else {
      // Pequeñas transiciones televisivas que NUNCA acercan más allá de baseZ ni recortan letras
      switch (cameraShot) {
        case 'CONTESTANT_ENTRY':
          swayX = Math.sin(t * 0.45) * 0.045;
          swayY = 0.02;
          extraZ = 0.05;
          break;
        case 'ACTIVE_QUESTION':
          swayX = Math.sin(t * 0.3) * 0.025;
          swayY = 0.01;
          extraZ = 0;
          break;
        case 'CELEBRATION':
          swayX = Math.sin(t * 1.1) * 0.04;
          swayY = 0.03;
          extraZ = 0.02;
          break;
        case 'TURN_END':
          swayX = 0;
          swayY = 0;
          extraZ = 0.25;
          break;
      }
    }

    const targetPos = new THREE.Vector3(swayX, swayY, baseZ + extraZ);
    const targetLook = new THREE.Vector3(0, lookY, 0);

    // Si cambia drásticamente el tamaño/orientación o en el primer frame, encuadrar de inmediato
    if (!initializedRef.current || Math.abs(lastCameraZRef.current - baseZ) > 0.6) {
      camera.position.copy(targetPos);
      lookAtTarget.current.copy(targetLook);
      camera.lookAt(lookAtTarget.current);
      initializedRef.current = true;
      lastCameraZRef.current = baseZ;
      return;
    }

    lastCameraZRef.current = baseZ;
    camera.position.lerp(targetPos, 0.12);
    lookAtTarget.current.lerp(targetLook, 0.12);
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
      {/* Pared curva amplia de plató azul profundo (cubre aspectos ultrapanorámicos y verticales) */}
      <mesh position={[0, 0, -4.4]} receiveShadow>
        <planeGeometry args={[64, 42]} />
        <meshStandardMaterial color="#0044cc" roughness={0.65} metalness={0.1} />
      </mesh>

      {/* Halo central luminoso de plató detrás del concursante */}
      <mesh position={[0, 0, -2.8]}>
        <circleGeometry args={[3.5, 48]} />
        <meshBasicMaterial color="#0077ff" transparent opacity={0.42} />
      </mesh>
      <mesh position={[0, 0, -2.5]}>
        <circleGeometry args={[2.15, 48]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.22} />
      </mesh>

      {/* Anillos decorativos sutiles de plató televisivo en el fondo */}
      <group ref={ringsRef} position={[0, 0, -2.2]}>
        <mesh position={[-3.0, -0.6, -0.4]}>
          <ringGeometry args={[0.85, 1.18, 40]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.35} />
        </mesh>
        <mesh position={[3.2, 0.7, -0.4]}>
          <ringGeometry args={[0.95, 1.3, 40]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.35} />
        </mesh>
        <mesh position={[0, 0, -0.2]}>
          <ringGeometry args={[2.95, 3.05, 64]} />
          <meshBasicMaterial color="#60a5fa" transparent opacity={0.22} />
        </mesh>
      </group>

      {/* Haces de iluminación volumétrica de plató */}
      <mesh position={[-3.2, 3.3, -1.8]} rotation={[0, 0, 0.42]}>
        <coneGeometry args={[1.6, 8.2, 24, 1, true]} />
        <meshBasicMaterial
          color="#60a5fa"
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[3.2, 3.3, -1.8]} rotation={[0, 0, -0.42]}>
        <coneGeometry args={[1.6, 8.2, 24, 1, true]} />
        <meshBasicMaterial
          color="#60a5fa"
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Suelo reflectante del plató situado por debajo del círculo completo del rosco */}
      <mesh position={[0, -2.75, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[16, 48]} />
        <meshStandardMaterial color="#031852" roughness={0.25} metalness={0.55} />
      </mesh>
    </group>
  );
};

// ============================================================================
// ALTERNATIVA 2D RESPONSIVE SI WEBGL NO ESTÁ DISPONIBLE (RESIZEOBSERVER)
// ============================================================================

export const Studio2DFallback: React.FC<{
  activeContestant: ContestantState | null;
  activeLetter: RoscoLetter | null;
}> = ({ activeContestant, activeLetter }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [boxSize, setBoxSize] = useState({ width: 360, height: 360 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBoxSize({ width: rect.width, height: rect.height });
      }
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const letters = activeContestant?.letters;
  const wheelSize = Math.max(190, Math.floor(Math.min(boxSize.width, boxSize.height) * 0.92));
  const dotSize = Math.max(18, Math.min(44, Math.floor(wheelSize * 0.082)));
  const avatarDiameter = Math.max(68, Math.floor(wheelSize * 0.34));
  const fontSizePx = Math.max(10, Math.floor(dotSize * 0.46));

  return (
    <div
      ref={containerRef}
      data-testid="rosco-2d-fallback"
      className="relative w-full h-full flex items-center justify-center bg-gradient-to-b from-[#0055ff] via-[#003bb5] to-[#021447] overflow-hidden select-none"
    >
      <div
        style={{ width: wheelSize, height: wheelSize }}
        className="relative flex items-center justify-center shrink-0"
      >
        {ROSCO_LETTERS.map((letter, idx) => {
          const angle = Math.PI / 2 - (idx * 2 * Math.PI) / ROSCO_LETTERS.length;
          const r = 42.5; // porcentaje del contenedor cuadrado, dejando margen de seguridad
          const left = 50 + Math.cos(angle) * r;
          const top = 50 - Math.sin(angle) * r;
          const st: LetterState = letters?.[letter]?.state ?? 'UNSEEN';
          const isAct = activeLetter === letter || st === 'ACTIVE';

          let bgClass = 'bg-slate-700/90 border-blue-300/60';
          if (isAct) bgClass = 'bg-blue-600 border-white scale-120 shadow-rosco-blue z-20';
          else if (st === 'CORRECT') bgClass = 'bg-emerald-500 border-emerald-200 shadow-rosco-green';
          else if (st === 'INCORRECT') bgClass = 'bg-red-600 border-red-200 shadow-rosco-red';
          else if (st === 'PASSED') bgClass = 'bg-amber-500 border-amber-200 shadow-rosco-amber';

          return (
            <div
              key={letter}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                width: dotSize,
                height: dotSize,
                fontSize: fontSizePx,
              }}
              className={`-translate-x-1/2 -translate-y-1/2 absolute rounded-full border-2 flex items-center justify-center font-display font-extrabold text-white transition-all duration-300 ${bgClass}`}
            >
              {letter}
            </div>
          );
        })}

        {/* Avatar central 2D estilizado y proporcional */}
        <div className="flex flex-col items-center justify-center text-center z-10">
          <div
            style={{ width: avatarDiameter, height: avatarDiameter }}
            className="rounded-full border-4 border-white/40 shadow-2xl flex flex-col items-center justify-end overflow-hidden"
          >
            <div
              className="w-full h-full flex flex-col items-center justify-end"
              style={{ backgroundColor: activeContestant?.avatar.outfitColor || '#2ce5c4' }}
            >
              <div
                style={{
                  width: Math.floor(avatarDiameter * 0.44),
                  height: Math.floor(avatarDiameter * 0.44),
                  backgroundColor: activeContestant?.avatar.skinColor || '#ecc09e',
                }}
                className="rounded-full mb-1 border-2 border-black/10"
              />
              <div className="w-[82%] py-1 rounded-t-xl bg-black/20 flex items-center justify-center">
                <span className="px-1.5 py-0.5 rounded-full bg-amber-600 text-[9px] sm:text-[10px] font-bold text-white truncate max-w-full">
                  {activeContestant?.name || 'PLATÓ PRL'}
                </span>
              </div>
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
// COMPONENTE PRINCIPAL DEL ESCENARIO 3D TELEVISIVO RESPONSIVE
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
  hudTimer?: React.ReactNode;
  hudCompactTimer?: React.ReactNode;
  hudLetter?: React.ReactNode;
  stageHeightClassName?: string;
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
  hudTimer,
  hudCompactTimer,
  hudLetter,
  stageHeightClassName = 'h-full',
}) => {
  const stageContainerRef = useRef<HTMLDivElement>(null);
  const [webglAvailable, setWebglAvailable] = useState(true);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({
    width: 800,
    height: 460,
  });

  useEffect(() => {
    setWebglAvailable(detectWebGLSupport());
  }, []);

  // ResizeObserver + cambios de orientación/zoom para adaptar cámara y rosco al tamaño real del contenedor
  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize((prev) =>
          Math.abs(prev.width - rect.width) > 1 || Math.abs(prev.height - rect.height) > 1
            ? { width: rect.width, height: rect.height }
            : prev
        );
      }
    };

    updateSize();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateSize);
      observer.observe(el);
    }

    const handleOrientation = () => {
      requestAnimationFrame(updateSize);
      setTimeout(updateSize, 120);
    };

    window.addEventListener('resize', updateSize);
    window.addEventListener('orientationchange', handleOrientation);
    window.visualViewport?.addEventListener('resize', updateSize);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('orientationchange', handleOrientation);
      window.visualViewport?.removeEventListener('resize', updateSize);
    };
  }, []);

  const isPodiumView = Boolean(isGameFinished && leaderboard.length > 0);

  const metrics = useMemo(
    () =>
      computeResponsiveStageMetrics(stageSize.width, stageSize.height, {
        isPodium: isPodiumView,
      }),
    [stageSize.width, stageSize.height, isPodiumView]
  );

  const isRoscoCompleteGold = useMemo(() => {
    if (!activeContestant) return false;
    return (
      activeContestant.score.pendingCount === 0 && activeContestant.score.correctCount === 27
    );
  }, [activeContestant]);

  const fallbackNode = (
    <Studio2DFallback activeContestant={activeContestant} activeLetter={activeLetter} />
  );

  const avatarConfig = activeContestant?.avatar ?? DEFAULT_AVATAR_CONFIGS[0];
  const avatarName = activeContestant?.name ?? 'PRL-ROSCO';
  const hasHud = Boolean(hudTimer || hudCompactTimer || hudLetter);
  const useCompactHud = stageSize.height < 340 || stageSize.width < 460;
  const effectiveTimerNode = useCompactHud && hudCompactTimer ? hudCompactTimer : hudTimer;

  return (
    <div
      className={
        stageHeightClassName === 'h-full'
          ? 'w-full h-full flex flex-col min-h-0'
          : 'w-full flex flex-col min-h-0'
      }
    >
      {/* Área del escenario 3D (mide su altura real independientemente de la barra HUD inferior) */}
      <div
        ref={stageContainerRef}
        data-testid="tv-studio-stage-3d"
        className={`relative w-full ${stageHeightClassName} bg-gradient-to-b from-[#0055ff] via-[#003bb5] to-[#021447] overflow-hidden`}
      >
        {!webglAvailable || force2DFallback ? (
          fallbackNode
        ) : (
          <WebGLErrorBoundary fallback={fallbackNode}>
            <Canvas
              shadows
              dpr={[1, 2]}
              camera={{
                position: [0, 0, metrics.cameraZ],
                fov: ROSCO_CAMERA_FOV,
                near: 0.1,
                far: 80,
              }}
              style={{ width: '100%', height: '100%', display: 'block' }}
            >
              <color attach="background" args={['#0042c4']} />
              <fog attach="fog" args={['#0036a3', Math.max(18, metrics.cameraZ + 4), Math.max(36, metrics.cameraZ + 22)]} />

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

              <CameraController3D
                cameraShot={cameraShot}
                isPodium={isPodiumView}
                metrics={metrics}
              />
              <StudioBackdrop3D />

              {isPodiumView ? (
                <Podium3D contestants={allContestants} leaderboard={leaderboard} />
              ) : (
                <group position={[0, 0, 0]}>
                  {/* Personaje humano 3D perfectamente centrado dentro del anillo */}
                  <ContestantAvatar3D
                    name={avatarName}
                    avatar={avatarConfig}
                    animationState={characterAnimation}
                    position={[0, -0.86, 0]}
                    scale={1.08}
                    showBadge={true}
                  />

                  {/* Rosco circular 3D de 27 letras centrado en (0, 0) */}
                  <RoscoWheel3D
                    letters={activeContestant?.letters ?? null}
                    activeLetter={activeLetter}
                    isRoscoCompleteGold={isRoscoCompleteGold}
                    radius={ROSCO_WORLD_RADIUS}
                    centerY={0}
                  />
                </group>
              )}
            </Canvas>
          </WebGLErrorBoundary>
        )}

        {/* En pantallas anchas donde hay >=175px libres fuera del círculo, flotamos en las esquinas laterales */}
        {hasHud && metrics.canShowCornerHud && (
          <>
            {effectiveTimerNode && (
              <div
                data-testid="hud-wing-left"
                className="absolute bottom-2.5 left-3 z-10 pointer-events-none"
              >
                {effectiveTimerNode}
              </div>
            )}
            {hudLetter && (
              <div
                data-testid="hud-wing-right"
                className="absolute bottom-2.5 right-3 z-10 pointer-events-none"
              >
                {hudLetter}
              </div>
            )}
          </>
        )}
      </div>

      {/* En móviles, tablets, portátiles o ventanas estrechas, el HUD se acopla debajo sin tapar jamás una sola letra */}
      {hasHud && !metrics.canShowCornerHud && (
        <div
          data-testid="hud-docked-bar"
          className="shrink-0 px-3 py-2 bg-studio-950/95 border-t border-blue-400/30 flex items-center justify-between gap-2"
        >
          <div className="min-w-0">{effectiveTimerNode}</div>
          <div className="shrink-0">{hudLetter}</div>
        </div>
      )}
    </div>
  );
};
