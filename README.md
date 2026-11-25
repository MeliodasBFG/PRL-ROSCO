# PRL-ROSCO — Concurso Televisivo Multijugador 3D de Prevención de Riesgos Laborales

Aplicación web interactiva de concurso televisivo en 3D inspirada en los concursos de rosco alfabético de 27 letras (`A-Z` incluida la `Ñ`), diseñada específicamente para la formación en **Prevención de Riesgos Laborales (PRL)**, dirigida en directo por un profesor/presentador y con soporte para hasta **15 concursantes simultáneos**.

> **Nota de independencia total**: Este proyecto (`PRL-ROSCO`) es 100 % independiente de `PRL-OCA`. Utiliza su propio Worker (`prl-rosco-api`), su propia base de datos Cloudflare D1 (`prl-rosco-db`), su propio Durable Object (`RoscoRoomDO`) y su propio proyecto de Cloudflare Pages (`prl-rosco`).

---

## 1. Arquitectura Técnica

- **Frontend (`src/`)**:
  - **React 18 + TypeScript + Vite + Tailwind CSS**.
  - **Escenario 3D (`src/components/studio3d/`)**: Construido con **Three.js**, **React Three Fiber (`@react-three/fiber`)** y **`@react-three/drei`**.
    - `ContestantAvatar3D.tsx`: Personaje humano 3D articulado y configurable (tono de piel, 6 peinados 3D, color de pelo, polo de plató con micrófono de solapa, chapa identificativa con nombre en el pecho y accesorios como casco EPI de PRL, gafas o auriculares) con **12 animaciones procedurales** (respiración, parpadeo, movimiento natural de cabeza y brazos, espera, concentración, celebración por acierto, reacción por fallo, reacción al Pasapalabra, presentación de turno, final de rosco y victoria en el podio).
    - `RoscoWheel3D.tsx`: Rosco circular 3D de **27 esferas luminosas** (`A B C D E F G H I J K L M N Ñ O P Q R S T U V W X Y Z`) con distribución circular uniforme, aro luminoso biselado, estados de color y animaciones de pulso/escala.
    - `Podium3D.tsx`: Podio 3D final para el 1.º, 2.º y 3.er puesto con avatares 3D y lluvia de confeti tridimensional.
    - `Studio2DFallback`: Alternativa 2D automática si el dispositivo no dispone de WebGL.
  - **Identidad Sonora Original (`src/audio/soundEngine.ts`)**: Sintetizador polifónico Web Audio API con 12 efectos sonoros de concurso y 4 pistas de música ambiental procedural con controles independientes de volumen.
  - **Estado y Sincronización (`src/store/useRoscoStore.ts`)**: Store en Zustand sincronizado con el servidor autoritativo mediante WebSockets, HTTP y BroadcastChannel.

- **Backend Autoritativo (`worker/` y `shared/`)**:
  - **Cloudflare Workers (`worker/index.ts`)** + **Cloudflare Durable Objects (`worker/RoscoRoomDO.ts`)** + **Motor Autoritativo (`shared/roscoGameEngine.ts`)**.
  - **Banco de Preguntas PRL (`shared/prlQuestionBank.ts`)**: **135 preguntas verificadas** (5 por cada una de las 27 letras, incluida la `Ñ`) distribuidas en las **24 categorías oficiales de PRL** con referencias normativas reales del **BOE** y del **INSST** (Ley 31/1995, RD 39/1997, RD 485/1997, RD 486/1997, RD 487/1997, RD 488/1997, RD 773/1997, RD 1215/1997, RD 1627/1997, RD 614/2001, RD 374/2001, RD 286/2006, RD 1311/2005, RD 664/1997, RD 513/2017 y NTPs).
  - **Base de Datos Cloudflare D1 (`migrations/`)**: 13 tablas relacionales (`rooms`, `players`, `player_sessions`, `questions`, `question_answers`, `game_rounds`, `round_questions`, `player_roscos`, `player_letter_states`, `player_timers`, `scores`, `game_events`, `game_results`).

---

## 2. Variables de Entorno

Copia `.env.example` a `.env.local` para desarrollo local o configúralas en Cloudflare Pages:

```env
VITE_API_URL=http://localhost:8787
VITE_WS_URL=ws://localhost:8787
```

En producción en Cloudflare Pages:
```env
VITE_API_URL=https://prl-rosco-api.<tu-subdominio>.workers.dev
VITE_WS_URL=wss://prl-rosco-api.<tu-subdominio>.workers.dev
```

---

## 3. Desarrollo y Pruebas Locales

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar servidor de desarrollo (incluye middleware autoritativo de salas en tiempo real)
npm run dev

# 3. Ejecutar pruebas unitarias y de integración (Vitest)
npm test

# 4. Comprobación de tipos TypeScript
npm run typecheck

# 5. Compilar frontend para producción
npm run build
```

---

## 4. Despliegue Paso a Paso en Cloudflare (Recursos Independientes)

### Paso 1: Crear la base de datos D1 exclusiva `prl-rosco-db`
```bash
npx wrangler d1 create prl-rosco-db
```
Copia el `database_id` devuelto por el comando y pégalo en `wrangler.toml` dentro de `[[d1_databases]]`.

### Paso 2: Aplicar las migraciones D1 (13 tablas + seed de 135 preguntas PRL)
```bash
# En local:
npx wrangler d1 migrations apply prl-rosco-db --local

# En producción (remoto):
npx wrangler d1 migrations apply prl-rosco-db --remote
```

### Paso 3: Desplegar el Cloudflare Worker y el Durable Object `RoscoRoomDO`
```bash
# Comprobación previa (dry-run):
npx wrangler deploy --dry-run

# Despliegue real en Cloudflare Workers:
npx wrangler deploy
```

### Paso 4: Desplegar el Frontend en Cloudflare Pages (`prl-rosco`)
```bash
npm run build
npx wrangler pages project create prl-rosco --production-branch main
npx wrangler pages deploy dist --project-name prl-rosco
```
