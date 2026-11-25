import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { AvatarConfig, CharacterAnimationState } from '../../../shared/types';

interface ContestantAvatar3DProps {
  name: string;
  avatar: AvatarConfig;
  animationState: CharacterAnimationState;
  position?: [number, number, number];
  scale?: number;
  showBadge?: boolean;
}

/**
 * Personaje humano 3D configurable y articulado para PRL-ROSCO.
 * Implementa las 12 animaciones requeridas:
 * 1. Respiración, 2. Parpadeo, 3. Movimiento natural de cabeza, 4. Movimiento suave de brazos,
 * 5. Espera (WAIT), 6. Concentración (CONCENTRATION), 7. Celebración por acierto (CELEBRATE_CORRECT),
 * 8. Reacción por fallo (REACT_INCORRECT), 9. Reacción al Pasapalabra (REACT_PASAPALABRA),
 * 10. Presentación al comenzar turno (TURN_INTRO), 11. Final de rosco (ROSCO_COMPLETE),
 * 12. Celebración final (FINAL_VICTORY).
 */
export const ContestantAvatar3D: React.FC<ContestantAvatar3DProps> = ({
  name,
  avatar,
  animationState,
  position = [0, -0.55, 0],
  scale = 1,
  showBadge = true,
}) => {
  const rootRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftEyelidRef = useRef<THREE.Mesh>(null);
  const rightEyelidRef = useRef<THREE.Mesh>(null);
  const leftBrowRef = useRef<THREE.Mesh>(null);
  const rightBrowRef = useRef<THREE.Mesh>(null);
  const mouthRef = useRef<THREE.Mesh>(null);

  const animTimerRef = useRef(0);
  const lastStateRef = useRef<CharacterAnimationState>(animationState);

  if (lastStateRef.current !== animationState) {
    lastStateRef.current = animationState;
    animTimerRef.current = 0;
  }

  const displayName = useMemo(() => {
    const clean = (name || 'CONCURSANTE').toUpperCase();
    return clean.length > 10 ? clean.slice(0, 10) : clean;
  }, [name]);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();
    animTimerRef.current += delta;
    const stTime = animTimerRef.current;

    if (
      !rootRef.current ||
      !torsoRef.current ||
      !headRef.current ||
      !leftArmRef.current ||
      !rightArmRef.current
    ) {
      return;
    }

    // 1. Respiración continua natural (pecho y hombros)
    const breath = Math.sin(t * 2.2) * 0.018;
    torsoRef.current.position.y = breath;
    torsoRef.current.scale.set(1 + breath * 0.4, 1 + breath * 0.5, 1 + breath * 0.4);

    // 2. Parpadeo natural cada ~3.4 segundos
    const blinkCycle = t % 3.4;
    const isBlinking = blinkCycle > 3.22 && blinkCycle < 3.38;
    const eyelidScaleY = isBlinking ? 1 : 0.08;
    if (leftEyelidRef.current && rightEyelidRef.current) {
      leftEyelidRef.current.scale.y = THREE.MathUtils.lerp(
        leftEyelidRef.current.scale.y,
        eyelidScaleY,
        0.45
      );
      rightEyelidRef.current.scale.y = THREE.MathUtils.lerp(
        rightEyelidRef.current.scale.y,
        eyelidScaleY,
        0.45
      );
    }

    // Valores base para cabeza, brazos y expresión facial (3. Movimiento de cabeza y 4. Brazos)
    let targetHeadRotX = Math.sin(t * 1.1) * 0.04;
    let targetHeadRotY = Math.sin(t * 0.7) * 0.08;
    let targetHeadRotZ = Math.cos(t * 0.8) * 0.025;

    let targetLeftArmRotZ = 0.22 + Math.sin(t * 1.5) * 0.03;
    let targetLeftArmRotX = Math.cos(t * 1.2) * 0.04;
    let targetRightArmRotZ = -0.22 - Math.sin(t * 1.5) * 0.03;
    let targetRightArmRotX = Math.sin(t * 1.2) * 0.04;

    let targetRootY = position[1];
    let targetRootRotY = 0;

    let browTilt = 0;
    let browHeight = 0.14;
    let mouthScaleX = 1;
    let mouthScaleY = 1;

    switch (animationState) {
      case 'WAIT':
        // 5. Animación de espera tranquila
        targetHeadRotY = Math.sin(t * 0.6) * 0.11;
        break;

      case 'CONCENTRATION':
        // 6. Animación de concentración (inspirada en la foto de referencia: ceño atento, labios presionados)
        targetHeadRotX = 0.09 + Math.sin(t * 1.8) * 0.025;
        targetHeadRotY = Math.sin(t * 0.9) * 0.05;
        browTilt = -0.14;
        browHeight = 0.125;
        mouthScaleX = 1.25;
        mouthScaleY = 0.45;
        break;

      case 'CELEBRATE_CORRECT':
        // 7. Celebración por acierto: brazos arriba con energía y sonrisa
        targetHeadRotX = -0.08 + Math.sin(t * 8) * 0.08;
        targetLeftArmRotZ = 0.85;
        targetLeftArmRotX = -1.35 + Math.sin(t * 9) * 0.25;
        targetRightArmRotZ = -0.85;
        targetRightArmRotX = -1.35 - Math.sin(t * 9) * 0.25;
        targetRootY = position[1] + Math.abs(Math.sin(t * 7)) * 0.08;
        browTilt = 0.12;
        browHeight = 0.16;
        mouthScaleX = 1.35;
        mouthScaleY = 1.6;
        break;

      case 'REACT_INCORRECT':
        // 8. Reacción por fallo: negación con la cabeza y hombros caídos
        targetHeadRotY = Math.sin(t * 9) * 0.26 * Math.exp(-stTime * 0.6);
        targetHeadRotX = 0.22;
        targetLeftArmRotZ = 0.12;
        targetRightArmRotZ = -0.12;
        targetRootY = position[1] - 0.04;
        browTilt = 0.18;
        browHeight = 0.12;
        mouthScaleX = 0.85;
        mouthScaleY = 0.6;
        break;

      case 'REACT_PASAPALABRA':
        // 9. Reacción al Pasapalabra: gesto de mano derecha y asentimiento reflexivo
        targetHeadRotZ = 0.09;
        targetHeadRotX = Math.sin(t * 5) * 0.07;
        targetRightArmRotX = -0.75 + Math.sin(t * 6) * 0.15;
        targetRightArmRotZ = -0.5;
        browTilt = 0.08;
        mouthScaleX = 1.1;
        mouthScaleY = 0.7;
        break;

      case 'TURN_INTRO':
        // 10. Presentación al comenzar el turno: saludo a cámara y giro de entrada
        if (stTime < 1.8) {
          targetRootRotY = Math.sin((1.8 - stTime) * 1.4) * 0.35;
          targetRightArmRotX = -1.45;
          targetRightArmRotZ = -0.65 + Math.sin(t * 10) * 0.22;
          targetHeadRotX = -0.05;
        }
        browHeight = 0.155;
        mouthScaleX = 1.25;
        mouthScaleY = 1.3;
        break;

      case 'ROSCO_COMPLETE':
        // 11. Animación al terminar el rosco: saludo y respiro profundo
        targetHeadRotX = Math.sin(t * 2.5) * 0.12;
        targetLeftArmRotX = -0.55;
        targetRightArmRotX = -0.55;
        mouthScaleX = 1.2;
        mouthScaleY = 1.2;
        break;

      case 'FINAL_VICTORY':
        // 12. Celebración final: salto en el podio y ambos brazos alzados
        targetRootY = position[1] + Math.abs(Math.sin(t * 6.5)) * 0.14;
        targetRootRotY = Math.sin(t * 2.2) * 0.25;
        targetLeftArmRotX = -2.3 + Math.sin(t * 8) * 0.2;
        targetLeftArmRotZ = 0.55;
        targetRightArmRotX = -2.3 - Math.sin(t * 8) * 0.2;
        targetRightArmRotZ = -0.55;
        targetHeadRotX = -0.12;
        browHeight = 0.165;
        mouthScaleX = 1.4;
        mouthScaleY = 1.8;
        break;
    }

    // Interpolación suave de todas las articulaciones
    rootRef.current.position.y = THREE.MathUtils.lerp(rootRef.current.position.y, targetRootY, 0.15);
    rootRef.current.rotation.y = THREE.MathUtils.lerp(
      rootRef.current.rotation.y,
      targetRootRotY,
      0.12
    );

    headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, targetHeadRotX, 0.15);
    headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, targetHeadRotY, 0.15);
    headRef.current.rotation.z = THREE.MathUtils.lerp(headRef.current.rotation.z, targetHeadRotZ, 0.15);

    leftArmRef.current.rotation.z = THREE.MathUtils.lerp(
      leftArmRef.current.rotation.z,
      targetLeftArmRotZ,
      0.16
    );
    leftArmRef.current.rotation.x = THREE.MathUtils.lerp(
      leftArmRef.current.rotation.x,
      targetLeftArmRotX,
      0.16
    );
    rightArmRef.current.rotation.z = THREE.MathUtils.lerp(
      rightArmRef.current.rotation.z,
      targetRightArmRotZ,
      0.16
    );
    rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
      rightArmRef.current.rotation.x,
      targetRightArmRotX,
      0.16
    );

    if (leftBrowRef.current && rightBrowRef.current) {
      leftBrowRef.current.rotation.z = THREE.MathUtils.lerp(
        leftBrowRef.current.rotation.z,
        browTilt,
        0.2
      );
      rightBrowRef.current.rotation.z = THREE.MathUtils.lerp(
        rightBrowRef.current.rotation.z,
        -browTilt,
        0.2
      );
      leftBrowRef.current.position.y = THREE.MathUtils.lerp(
        leftBrowRef.current.position.y,
        browHeight,
        0.2
      );
      rightBrowRef.current.position.y = THREE.MathUtils.lerp(
        rightBrowRef.current.position.y,
        browHeight,
        0.2
      );
    }

    if (mouthRef.current) {
      mouthRef.current.scale.x = THREE.MathUtils.lerp(mouthRef.current.scale.x, mouthScaleX, 0.2);
      mouthRef.current.scale.y = THREE.MathUtils.lerp(mouthRef.current.scale.y, mouthScaleY, 0.2);
    }
  });

  return (
    <group ref={rootRef} position={position} scale={scale}>
      {/* TORSO Y POLO DE PLATÓ (inspirado en la imagen de referencia) */}
      <group ref={torsoRef}>
        {/* Tronco principal con camisa tipo polo */}
        <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.48, 0.43, 1.15, 28]} />
          <meshStandardMaterial
            color={avatar.outfitColor || '#2ce5c4'}
            roughness={0.55}
            metalness={0.05}
          />
        </mesh>

        {/* Hombros redondeados */}
        <mesh position={[0, 0.64, 0]} scale={[1.28, 0.45, 0.85]} castShadow>
          <sphereGeometry args={[0.46, 24, 18]} />
          <meshStandardMaterial color={avatar.outfitColor || '#2ce5c4'} roughness={0.55} />
        </mesh>

        {/* Cuello del polo (solapas izquierda y derecha) */}
        <mesh position={[-0.14, 0.76, 0.22]} rotation={[0.35, 0.3, -0.35]} castShadow>
          <boxGeometry args={[0.18, 0.12, 0.05]} />
          <meshStandardMaterial color={avatar.collarColor || '#22c7a9'} roughness={0.5} />
        </mesh>
        <mesh position={[0.14, 0.76, 0.22]} rotation={[0.35, -0.3, 0.35]} castShadow>
          <boxGeometry args={[0.18, 0.12, 0.05]} />
          <meshStandardMaterial color={avatar.collarColor || '#22c7a9'} roughness={0.5} />
        </mesh>

        {/* Tapeta de botones del polo y micrófono de solapa de TV */}
        <mesh position={[0, 0.56, 0.41]} castShadow>
          <boxGeometry args={[0.09, 0.32, 0.04]} />
          <meshStandardMaterial color={avatar.collarColor || '#22c7a9'} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.58, 0.44]}>
          <sphereGeometry args={[0.02, 12, 12]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.2} />
        </mesh>

        {/* Micrófono de solapa televisivo */}
        <group position={[0.06, 0.5, 0.45]} rotation={[0, 0, -0.3]}>
          <mesh>
            <cylinderGeometry args={[0.018, 0.018, 0.07, 12]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.6} />
          </mesh>
          <mesh position={[0, 0.04, 0]}>
            <sphereGeometry args={[0.024, 12, 12]} />
            <meshStandardMaterial color="#1e293b" roughness={0.8} />
          </mesh>
        </group>

        {/* Chapa / Identificador circular del concursante en el pecho (como en la imagen de referencia) */}
        {showBadge && (
          <group position={[0.25, 0.36, 0.44]} rotation={[0.06, 0.18, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.15, 0.15, 0.03, 28]} />
              <meshStandardMaterial
                color={avatar.badgeColor || '#ea580c'}
                roughness={0.3}
                metalness={0.35}
              />
            </mesh>
            <mesh position={[0, 0, 0.016]}>
              <ringGeometry args={[0.125, 0.145, 28]} />
              <meshBasicMaterial color="#fde047" />
            </mesh>
            <Text
              position={[0, -0.01, 0.022]}
              fontSize={0.044}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.004}
              outlineColor="#7c2d12"
            >
              {displayName}
            </Text>
          </group>
        )}

        {/* BRAZO IZQUIERDO ARTICULADO */}
        <group ref={leftArmRef} position={[-0.55, 0.56, 0]}>
          {/* Manga corta del polo */}
          <mesh position={[-0.06, -0.14, 0]} rotation={[0, 0, -0.12]} castShadow>
            <cylinderGeometry args={[0.15, 0.135, 0.32, 18]} />
            <meshStandardMaterial color={avatar.outfitColor || '#2ce5c4'} roughness={0.55} />
          </mesh>
          {/* Antebrazo */}
          <mesh position={[-0.1, -0.45, 0.04]} rotation={[0.15, 0, -0.08]} castShadow>
            <cylinderGeometry args={[0.11, 0.095, 0.42, 18]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
          </mesh>
          {/* Mano */}
          <mesh position={[-0.12, -0.7, 0.08]} castShadow>
            <sphereGeometry args={[0.105, 16, 16]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
          </mesh>
        </group>

        {/* BRAZO DERECHO ARTICULADO */}
        <group ref={rightArmRef} position={[0.55, 0.56, 0]}>
          {/* Manga corta del polo */}
          <mesh position={[0.06, -0.14, 0]} rotation={[0, 0, 0.12]} castShadow>
            <cylinderGeometry args={[0.15, 0.135, 0.32, 18]} />
            <meshStandardMaterial color={avatar.outfitColor || '#2ce5c4'} roughness={0.55} />
          </mesh>
          {/* Antebrazo */}
          <mesh position={[0.1, -0.45, 0.04]} rotation={[0.15, 0, 0.08]} castShadow>
            <cylinderGeometry args={[0.11, 0.095, 0.42, 18]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
          </mesh>
          {/* Mano */}
          <mesh position={[0.12, -0.7, 0.08]} castShadow>
            <sphereGeometry args={[0.105, 16, 16]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
          </mesh>
        </group>

        {/* CUELLO */}
        <mesh position={[0, 0.85, 0]} castShadow>
          <cylinderGeometry args={[0.155, 0.175, 0.28, 20]} />
          <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
        </mesh>

        {/* CABEZA Y ROSTRO 3D EXPRESIVO */}
        <group ref={headRef} position={[0, 1.24, 0.02]}>
          {/* Cráneo y mandíbula */}
          <mesh scale={[0.92, 1.08, 0.95]} castShadow>
            <sphereGeometry args={[0.37, 32, 28]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.42} />
          </mesh>

          {/* Orejas */}
          <mesh position={[-0.34, -0.02, -0.02]} scale={[0.45, 0.85, 0.55]}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
          </mesh>
          <mesh position={[0.34, -0.02, -0.02]} scale={[0.45, 0.85, 0.55]}>
            <sphereGeometry args={[0.11, 16, 16]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
          </mesh>

          {/* Nariz */}
          <mesh position={[0, -0.02, 0.35]} rotation={[-0.18, 0, 0]} castShadow>
            <coneGeometry args={[0.048, 0.13, 14]} />
            <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.4} />
          </mesh>

          {/* Ojo izquierdo */}
          <group position={[-0.125, 0.05, 0.31]}>
            <mesh scale={[1.1, 0.85, 0.6]}>
              <sphereGeometry args={[0.048, 16, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.15} />
            </mesh>
            <mesh position={[0, 0, 0.024]}>
              <sphereGeometry args={[0.024, 14, 14]} />
              <meshStandardMaterial color="#1e1b18" roughness={0.1} />
            </mesh>
            <mesh position={[0.008, 0.008, 0.042]}>
              <sphereGeometry args={[0.007, 8, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            {/* Párpado para parpadeo */}
            <mesh ref={leftEyelidRef} position={[0, 0.005, 0.01]} scale={[1.15, 0.08, 0.7]}>
              <sphereGeometry args={[0.05, 14, 14]} />
              <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
            </mesh>
          </group>

          {/* Ojo derecho */}
          <group position={[0.125, 0.05, 0.31]}>
            <mesh scale={[1.1, 0.85, 0.6]}>
              <sphereGeometry args={[0.048, 16, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.15} />
            </mesh>
            <mesh position={[0, 0, 0.024]}>
              <sphereGeometry args={[0.024, 14, 14]} />
              <meshStandardMaterial color="#1e1b18" roughness={0.1} />
            </mesh>
            <mesh position={[0.008, 0.008, 0.042]}>
              <sphereGeometry args={[0.007, 8, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            {/* Párpado para parpadeo */}
            <mesh ref={rightEyelidRef} position={[0, 0.005, 0.01]} scale={[1.15, 0.08, 0.7]}>
              <sphereGeometry args={[0.05, 14, 14]} />
              <meshStandardMaterial color={avatar.skinColor || '#ecc09e'} roughness={0.45} />
            </mesh>
          </group>

          {/* Cejas articuladas */}
          <mesh ref={leftBrowRef} position={[-0.125, 0.14, 0.32]} rotation={[0, 0.15, 0]}>
            <boxGeometry args={[0.115, 0.024, 0.03]} />
            <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
          </mesh>
          <mesh ref={rightBrowRef} position={[0.125, 0.14, 0.32]} rotation={[0, -0.15, 0]}>
            <boxGeometry args={[0.115, 0.024, 0.03]} />
            <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
          </mesh>

          {/* Boca expresiva */}
          <mesh ref={mouthRef} position={[0, -0.16, 0.32]} scale={[1, 1, 1]}>
            <capsuleGeometry args={[0.018, 0.11, 8, 12]} />
            <meshStandardMaterial color="#a94b45" roughness={0.5} />
          </mesh>

          {/* PEINADOS CONFIGURABLES EN 3D */}
          <group>
            {/* Base capilar superior y nuca */}
            <mesh position={[0, 0.11, -0.03]} scale={[0.98, 0.96, 1.02]} castShadow>
              <sphereGeometry args={[0.375, 28, 22, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
              <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.65} />
            </mesh>

            {avatar.hairStyle === 'parted' && (
              <>
                <mesh position={[-0.05, 0.31, 0.17]} rotation={[0.25, 0.15, -0.22]} scale={[1.35, 0.55, 0.85]}>
                  <sphereGeometry args={[0.18, 20, 16]} />
                  <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
                </mesh>
                <mesh position={[0.16, 0.27, 0.14]} rotation={[0.2, -0.25, 0.3]} scale={[0.9, 0.45, 0.7]}>
                  <sphereGeometry args={[0.15, 16, 16]} />
                  <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
                </mesh>
              </>
            )}

            {avatar.hairStyle === 'curly' && (
              <>
                {[-0.22, -0.11, 0, 0.11, 0.22].map((x, i) => (
                  <mesh key={i} position={[x, 0.33 - Math.abs(x) * 0.25, 0.15]}>
                    <sphereGeometry args={[0.11, 14, 14]} />
                    <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.7} />
                  </mesh>
                ))}
              </>
            )}

            {avatar.hairStyle === 'bun' && (
              <mesh position={[0, 0.44, -0.16]} castShadow>
                <sphereGeometry args={[0.15, 18, 18]} />
                <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
              </mesh>
            )}

            {avatar.hairStyle === 'bob' && (
              <>
                <mesh position={[-0.31, -0.02, 0.02]} scale={[0.45, 1.25, 0.9]}>
                  <sphereGeometry args={[0.22, 16, 16]} />
                  <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
                </mesh>
                <mesh position={[0.31, -0.02, 0.02]} scale={[0.45, 1.25, 0.9]}>
                  <sphereGeometry args={[0.22, 16, 16]} />
                  <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
                </mesh>
              </>
            )}

            {avatar.hairStyle === 'spiky' && (
              <>
                {[-0.14, 0, 0.14].map((x, i) => (
                  <mesh key={i} position={[x, 0.42, 0.12]} rotation={[0.3, 0, -x]}>
                    <coneGeometry args={[0.09, 0.22, 10]} />
                    <meshStandardMaterial color={avatar.hairColor || '#1c1613'} roughness={0.6} />
                  </mesh>
                ))}
              </>
            )}
          </group>

          {/* ACCESORIOS CONFIGURABLES (Gafas, Casco EPI de PRL, Auriculares) */}
          {avatar.accessory === 'glasses' && (
            <group position={[0, 0.05, 0.34]}>
              <mesh position={[-0.125, 0, 0]}>
                <ringGeometry args={[0.055, 0.072, 24]} />
                <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.2} />
              </mesh>
              <mesh position={[0.125, 0, 0]}>
                <ringGeometry args={[0.055, 0.072, 24]} />
                <meshStandardMaterial color="#0f172a" metalness={0.7} roughness={0.2} />
              </mesh>
              <mesh position={[0, 0.01, 0]}>
                <boxGeometry args={[0.11, 0.016, 0.016]} />
                <meshStandardMaterial color="#0f172a" />
              </mesh>
            </group>
          )}

          {avatar.accessory === 'helmet' && (
            <group position={[0, 0.22, 0.01]}>
              <mesh scale={[1.05, 0.88, 1.08]} castShadow>
                <sphereGeometry args={[0.39, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
                <meshStandardMaterial color="#facc15" roughness={0.25} metalness={0.15} />
              </mesh>
              <mesh position={[0, 0.02, 0.34]} rotation={[0.2, 0, 0]} scale={[1.1, 0.2, 0.65]}>
                <cylinderGeometry args={[0.28, 0.32, 0.08, 24]} />
                <meshStandardMaterial color="#eab308" roughness={0.3} />
              </mesh>
            </group>
          )}

          {avatar.accessory === 'headset' && (
            <group>
              <mesh position={[0, 0.08, -0.02]} rotation={[0, 0, 0]}>
                <torusGeometry args={[0.37, 0.022, 12, 32, Math.PI]} />
                <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.3} />
              </mesh>
              <mesh position={[-0.37, -0.01, 0]} rotation={[0, Math.PI / 2, 0]}>
                <cylinderGeometry args={[0.08, 0.08, 0.06, 18]} />
                <meshStandardMaterial color="#1d4ed8" roughness={0.3} />
              </mesh>
              <mesh position={[0.37, -0.01, 0]} rotation={[0, Math.PI / 2, 0]}>
                <cylinderGeometry args={[0.08, 0.08, 0.06, 18]} />
                <meshStandardMaterial color="#1d4ed8" roughness={0.3} />
              </mesh>
            </group>
          )}
        </group>
      </group>
    </group>
  );
};
