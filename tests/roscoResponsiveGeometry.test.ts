import { describe, it, expect } from 'vitest';
import {
  computeResponsiveStageMetrics,
  ROSCO_OUTER_RADIUS,
  ROSCO_WORLD_RADIUS,
} from '../src/components/studio3d/TVStudioStage3D';
import { ROSCO_LETTERS } from '../shared/types';

/**
 * Proyecta un punto 3D (x, y, z) al plano normalizado de pantalla NDC [-1, 1]
 * usando la misma cámara perspectiva de Three.js (mirando desde (0, 0, cameraZ) a (0, 0, 0)).
 */
function projectPointToNdc(
  x: number,
  y: number,
  z: number,
  cameraZ: number,
  fovDeg: number,
  aspect: number
) {
  const dist = cameraZ - z;
  const tanHalfFov = Math.tan((fovDeg * Math.PI) / 360);
  const visibleHalfH = dist * tanHalfFov;
  const visibleHalfW = visibleHalfH * aspect;
  return {
    ndcX: x / visibleHalfW,
    ndcY: y / visibleHalfH,
    visibleHalfW,
    visibleHalfH,
  };
}

const TARGET_VIEWPORTS: Array<{
  label: string;
  viewportW: number;
  viewportH: number;
  stageW: number;
  stageH: number;
}> = [
  // Ordenadores y portátiles
  { label: '1920x1080 (Escritorio Full HD)', viewportW: 1920, viewportH: 1080, stageW: 920, stageH: 540 },
  { label: '1600x900 (Escritorio HD+)', viewportW: 1600, viewportH: 900, stageW: 880, stageH: 468 },
  { label: '1366x768 (Portátil estándar)', viewportW: 1366, viewportH: 768, stageW: 760, stageH: 380 },
  { label: '1280x720 (Portátil compacto)', viewportW: 1280, viewportH: 720, stageW: 710, stageH: 345 },
  { label: '1024x768 (Portátil/Tablet horizontal)', viewportW: 1024, viewportH: 768, stageW: 560, stageH: 360 },
  // Tablets vertical y horizontal
  { label: '768x1024 (Tablet vertical)', viewportW: 768, viewportH: 1024, stageW: 728, stageH: 470 },
  // Móviles vertical
  { label: '430x932 (Móvil grande vertical)', viewportW: 430, viewportH: 932, stageW: 406, stageH: 350 },
  { label: '390x844 (Móvil estándar vertical)', viewportW: 390, viewportH: 844, stageW: 366, stageH: 315 },
  { label: '360x800 (Móvil compacto vertical)', viewportW: 360, viewportH: 800, stageW: 336, stageH: 290 },
  // Móviles orientación horizontal
  { label: '932x430 (Móvil grande horizontal)', viewportW: 932, viewportH: 430, stageW: 890, stageH: 230 },
  { label: '844x390 (Móvil estándar horizontal)', viewportW: 844, viewportH: 390, stageW: 804, stageH: 230 },
  { label: '800x360 (Móvil compacto horizontal)', viewportW: 800, viewportH: 360, stageW: 760, stageH: 230 },
  // Contenedor muy estrecho (simulando pantalla dividida o zoom extremo)
  { label: '320x520 (Zoom / Split-screen extremo)', viewportW: 320, viewportH: 520, stageW: 296, stageH: 420 },
];

describe('PRL-ROSCO — Geometría Responsive del Rosco 3D (27 letras sin recortes)', () => {
  it.each(TARGET_VIEWPORTS)(
    'encuadra las 27 letras (incluida la Ñ) y su halo activo con margen de seguridad en $label',
    ({ stageW, stageH }) => {
      const metrics = computeResponsiveStageMetrics(stageW, stageH, { isPodium: false });

      expect(metrics.aspect).toBeCloseTo(stageW / stageH, 4);
      expect(metrics.cameraZ).toBeGreaterThan(5.0);

      // Comprobar que cada una de las 27 letras + su esfera/halo activo (radio exterior 0.36, z=0.29)
      // permanece estrictamente dentro del área visible [-1, 1] x [-1, 1] con al menos 5% de margen
      const activeZ = 0.29;
      const letterOuterEdge = 0.36;
      const maxSway = 0.05;

      for (let idx = 0; idx < ROSCO_LETTERS.length; idx++) {
        const angle = Math.PI / 2 - (idx * 2 * Math.PI) / ROSCO_LETTERS.length;
        const cx = Math.cos(angle) * ROSCO_WORLD_RADIUS;
        const cy = Math.sin(angle) * ROSCO_WORLD_RADIUS;

        // Extremos exteriores de la esfera activa incluyendo movimiento sutil de cámara
        const outerX = cx + Math.sign(cx) * letterOuterEdge + Math.sign(cx) * maxSway;
        const outerY = cy + Math.sign(cy) * letterOuterEdge + Math.sign(cy) * maxSway;

        const proj = projectPointToNdc(
          outerX,
          outerY,
          activeZ,
          metrics.cameraZ,
          metrics.fovDeg,
          metrics.aspect
        );

        expect(Math.abs(proj.ndcX)).toBeLessThanOrEqual(0.95);
        expect(Math.abs(proj.ndcY)).toBeLessThanOrEqual(0.95);
      }

      // Comprobar que la distancia entre letras adyacentes en el círculo impide solapamiento
      const chordBetweenCenters =
        2 * ROSCO_WORLD_RADIUS * Math.sin(Math.PI / ROSCO_LETTERS.length);
      const sphereDiameter = 0.205 * 2;
      expect(chordBetweenCenters).toBeGreaterThan(sphereDiameter);

      // Si canShowCornerHud es true, debe haber al menos 175px libres a cada lado fuera del círculo
      if (metrics.canShowCornerHud) {
        expect(metrics.sideWingPx).toBeGreaterThanOrEqual(175);
      }
    }
  );

  it('mantiene la proporción circular perfecta (escala horizontal igual a vertical en pantalla)', () => {
    const cases = [
      [1920, 540],
      [360, 290],
      [768, 470],
      [800, 230],
    ];
    for (const [w, h] of cases) {
      const m = computeResponsiveStageMetrics(w, h);
      const projTop = projectPointToNdc(0, ROSCO_WORLD_RADIUS, 0.15, m.cameraZ, m.fovDeg, m.aspect);
      const projRight = projectPointToNdc(ROSCO_WORLD_RADIUS, 0, 0.15, m.cameraZ, m.fovDeg, m.aspect);
      const pxRadiusY = projTop.ndcY * (h / 2);
      const pxRadiusX = projRight.ndcX * (w / 2);
      expect(pxRadiusX).toBeCloseTo(pxRadiusY, 2);
    }
  });

  it('encuadra también el Podio 3D completo (1º, 2º y 3º puesto) en escritorio y móvil', () => {
    for (const vp of TARGET_VIEWPORTS) {
      const metrics = computeResponsiveStageMetrics(vp.stageW, vp.stageH, { isPodium: true });
      const proj = projectPointToNdc(3.15, 2.25, 0.85, metrics.cameraZ, metrics.fovDeg, metrics.aspect);
      expect(Math.abs(proj.ndcX)).toBeLessThanOrEqual(0.96);
      expect(Math.abs(proj.ndcY)).toBeLessThanOrEqual(0.96);
    }
  });
});
