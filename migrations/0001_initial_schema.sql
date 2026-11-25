-- ============================================================================
-- PRL-ROSCO — MIGRACIÓN D1 0001: ESQUEMA COMPLETO DE 13 TABLAS
-- Base de datos independiente: prl-rosco-db
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Tabla de salas (rooms)
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  host_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING',
  timer_seconds INTEGER NOT NULL DEFAULT 120,
  points_correct INTEGER NOT NULL DEFAULT 10,
  points_incorrect INTEGER NOT NULL DEFAULT 0,
  points_pasapalabra INTEGER NOT NULL DEFAULT 0,
  show_leaderboard INTEGER NOT NULL DEFAULT 1,
  selected_categories TEXT NOT NULL DEFAULT '[]',
  selected_difficulty TEXT NOT NULL DEFAULT 'TODAS',
  active_player_id TEXT,
  current_round_id TEXT,
  state_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- 2. Tabla de jugadores / concursantes (players)
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_config TEXT NOT NULL,
  turn_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING',
  is_connected INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  UNIQUE(room_id, name)
);

CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id, turn_order);

-- 3. Tabla de sesiones y tokens individuales (player_sessions)
CREATE TABLE IF NOT EXISTS player_sessions (
  token_hash TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  player_id TEXT,
  role TEXT NOT NULL CHECK(role IN ('HOST', 'CONTESTANT')),
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_player_sessions_room ON player_sessions(room_id, role);

-- 4. Tabla de preguntas de PRL (questions)
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  letter TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('EMPIEZA_POR', 'CONTIENE')),
  statement TEXT NOT NULL,
  main_answer TEXT NOT NULL,
  accepted_variants TEXT NOT NULL DEFAULT '[]',
  synonyms TEXT NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK(difficulty IN ('FACIL', 'MEDIA', 'DIFICIL')),
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_questions_letter ON questions(letter, is_active);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);

-- 5. Tabla normalizada de respuestas y variantes privadas (question_answers)
CREATE TABLE IF NOT EXISTS question_answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  normalized_answer TEXT NOT NULL,
  answer_type TEXT NOT NULL CHECK(answer_type IN ('PRIMARY', 'VARIANT', 'SYNONYM')),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_answers_qid ON question_answers(question_id);

-- 6. Tabla de rondas de juego (game_rounds)
CREATE TABLE IF NOT EXISTS game_rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_rounds_room ON game_rounds(room_id, round_number);

-- 7. Tabla de las 27 preguntas seleccionadas para la ronda (round_questions)
CREATE TABLE IF NOT EXISTS round_questions (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  letter TEXT NOT NULL,
  question_id TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  FOREIGN KEY (round_id) REFERENCES game_rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id),
  UNIQUE(round_id, letter)
);

-- 8. Tabla de roscos individuales por concursante (player_roscos)
CREATE TABLE IF NOT EXISTS player_roscos (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  current_letter TEXT NOT NULL DEFAULT 'A',
  lap_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  started_at INTEGER,
  finished_at INTEGER,
  FOREIGN KEY (round_id) REFERENCES game_rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(round_id, player_id)
);

-- 9. Tabla de estado de cada una de las 27 letras de cada jugador (player_letter_states)
CREATE TABLE IF NOT EXISTS player_letter_states (
  id TEXT PRIMARY KEY,
  rosco_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  letter TEXT NOT NULL,
  question_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'UNSEEN' CHECK(state IN ('UNSEEN', 'ACTIVE', 'PASSED', 'CORRECT', 'INCORRECT')),
  presentation_order INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'PENDING',
  points_earned INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER,
  FOREIGN KEY (rosco_id) REFERENCES player_roscos(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE(rosco_id, letter)
);

CREATE INDEX IF NOT EXISTS idx_player_letter_states_player ON player_letter_states(player_id, letter);

-- 10. Tabla de cronómetros individuales autoritativos (player_timers)
CREATE TABLE IF NOT EXISTS player_timers (
  player_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  initial_ms INTEGER NOT NULL,
  remaining_ms INTEGER NOT NULL,
  consumed_ms INTEGER NOT NULL DEFAULT 0,
  is_running INTEGER NOT NULL DEFAULT 0,
  last_started_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, player_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

-- 11. Tabla de puntuaciones y estadísticas por jugador (scores)
CREATE TABLE IF NOT EXISTS scores (
  player_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  correct_count INTEGER NOT NULL DEFAULT 0,
  incorrect_count INTEGER NOT NULL DEFAULT 0,
  pasapalabra_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 27,
  total_points INTEGER NOT NULL DEFAULT 0,
  time_consumed_ms INTEGER NOT NULL DEFAULT 0,
  time_remaining_ms INTEGER NOT NULL DEFAULT 120000,
  accuracy_pct REAL NOT NULL DEFAULT 0,
  rank_position INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, player_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

-- 12. Tabla de eventos y registro de auditoría del presentador (game_events)
CREATE TABLE IF NOT EXISTS game_events (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  round_id TEXT,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  target_player_id TEXT,
  letter TEXT,
  payload_json TEXT NOT NULL,
  undoable INTEGER NOT NULL DEFAULT 0,
  undone_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_events_room_seq ON game_events(room_id, seq);

-- 13. Tabla de resultados históricos y podio final (game_results)
CREATE TABLE IF NOT EXISTS game_results (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  winner_player_id TEXT,
  podium_json TEXT NOT NULL,
  full_standings_json TEXT NOT NULL,
  total_duration_ms INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (round_id) REFERENCES game_rounds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_results_room ON game_results(room_id, finished_at);
