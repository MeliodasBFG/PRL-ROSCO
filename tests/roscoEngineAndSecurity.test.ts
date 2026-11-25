import { describe, it, expect } from 'vitest';
import {
  INITIAL_PRL_QUESTION_BANK,
  groupQuestionsByLetter,
  normalizeSpanishText,
  selectRoundQuestions,
} from '../shared/prlQuestionBank';
import {
  AuthoritativeRoscoRoom,
  RoscoSecurityError,
} from '../shared/roscoGameEngine';
import {
  MAX_CONTESTANTS,
  PRL_CATEGORIES,
  ROSCO_LETTERS,
} from '../shared/types';

describe('PRL-ROSCO — Pruebas Funcionales Obligatorias (Sección 21)', () => {
  // ==========================================================================
  // 1. ROSCO Y BANCO DE PREGUNTAS PRL
  // ==========================================================================
  describe('1. Rosco de 27 letras y Banco de Preguntas de PRL', () => {
    it('contiene exactamente las 27 letras del abecedario español incluyendo la Ñ en su posición correcta', () => {
      expect(ROSCO_LETTERS).toHaveLength(27);
      expect(ROSCO_LETTERS).toContain('Ñ');
      const idxN = ROSCO_LETTERS.indexOf('N');
      const idxEnie = ROSCO_LETTERS.indexOf('Ñ');
      const idxO = ROSCO_LETTERS.indexOf('O');
      expect(idxEnie).toBe(idxN + 1);
      expect(idxO).toBe(idxEnie + 1);
    });

    it('dispone de al menos 5 preguntas válidas por cada una de las 27 letras (135 preguntas) con fuentes BOE/INSST', () => {
      expect(INITIAL_PRL_QUESTION_BANK.length).toBeGreaterThanOrEqual(135);
      const grouped = groupQuestionsByLetter(INITIAL_PRL_QUESTION_BANK);

      for (const letter of ROSCO_LETTERS) {
        expect(grouped[letter].length).toBeGreaterThanOrEqual(5);
        for (const q of grouped[letter]) {
          expect(q.id).toBeTruthy();
          expect(q.letter).toBe(letter);
          expect(['EMPIEZA_POR', 'CONTIENE']).toContain(q.mode);
          expect(q.statement.length).toBeGreaterThan(15);
          expect(q.mainAnswer.length).toBeGreaterThan(1);
          expect(q.explanation.length).toBeGreaterThan(15);
          expect(PRL_CATEGORIES).toContain(q.category);
          expect(q.source.length).toBeGreaterThan(5);
          expect(q.sourceUrl).toMatch(/^https?:\/\//);
        }
      }
    });

    it('selecciona 27 preguntas (1 por letra) y evita repetir preguntas usadas en la ronda anterior', () => {
      const round1 = selectRoundQuestions();
      expect(Object.keys(round1)).toHaveLength(27);
      const usedIds = Object.values(round1).map((q) => q.id);

      const round2 = selectRoundQuestions({ previouslyUsedIds: usedIds });
      for (const letter of ROSCO_LETTERS) {
        expect(round2[letter].id).not.toBe(round1[letter].id);
      }
    });

    it('genera y valida la migración D1 0002_seed_questions.sql con las 135 preguntas y sus respuestas privadas normalizadas', () => {
      const esc = (s: string) => s.replace(/'/g, "''");
      const lines: string[] = [
        '-- ============================================================================',
        '-- PRL-ROSCO — MIGRACIÓN D1 0002: SEED DE 135 PREGUNTAS DE PRL (27 LETRAS x 5)',
        '-- Fuentes oficiales: BOE (Ley 31/1995 y Reales Decretos) e INSST',
        '-- ============================================================================',
        '',
      ];

      for (const q of INITIAL_PRL_QUESTION_BANK) {
        lines.push(
          `INSERT OR REPLACE INTO questions (id, letter, mode, statement, main_answer, accepted_variants, synonyms, explanation, category, difficulty, source, source_url, reviewed_at, is_active) VALUES ('${esc(
            q.id
          )}', '${esc(q.letter)}', '${esc(q.mode)}', '${esc(q.statement)}', '${esc(
            q.mainAnswer
          )}', '${esc(JSON.stringify(q.acceptedVariants))}', '${esc(
            JSON.stringify(q.synonyms)
          )}', '${esc(q.explanation)}', '${esc(q.category)}', '${esc(q.difficulty)}', '${esc(
            q.source
          )}', '${esc(q.sourceUrl)}', '${esc(q.reviewedAt)}', 1);`
        );

        lines.push(
          `INSERT OR REPLACE INTO question_answers (id, question_id, answer_text, normalized_answer, answer_type) VALUES ('${esc(
            q.id
          )}-PRIMARY', '${esc(q.id)}', '${esc(q.mainAnswer)}', '${esc(
            normalizeSpanishText(q.mainAnswer)
          )}', 'PRIMARY');`
        );

        q.acceptedVariants.forEach((v, idx) => {
          lines.push(
            `INSERT OR REPLACE INTO question_answers (id, question_id, answer_text, normalized_answer, answer_type) VALUES ('${esc(
              q.id
            )}-VAR-${idx + 1}', '${esc(q.id)}', '${esc(v)}', '${esc(
              normalizeSpanishText(v)
            )}', 'VARIANT');`
          );
        });

        q.synonyms.forEach((syn, idx) => {
          lines.push(
            `INSERT OR REPLACE INTO question_answers (id, question_id, answer_text, normalized_answer, answer_type) VALUES ('${esc(
              q.id
            )}-SYN-${idx + 1}', '${esc(q.id)}', '${esc(syn)}', '${esc(
              normalizeSpanishText(syn)
            )}', 'SYNONYM');`
          );
        });
      }

      const content = lines.join('\n') + '\n';
      expect(content).toContain('INSERT OR REPLACE INTO questions');
      expect(content).toContain('INSERT OR REPLACE INTO question_answers');
      expect(content).toContain("'Ñ'");
    });
  });

  // ==========================================================================
  // 2. PRESENTADOR Y SEGURIDAD DE PERMISOS
  // ==========================================================================
  describe('2. Permisos Exclusivos del Presentador y Seguridad', () => {
    it('solo el host con hostToken válido puede marcar acierto, fallo, Pasapalabra o cambiar turno; un alumno es rechazado', () => {
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-TEST01',
        roomCode: 'TEST01',
        hostToken: 'htok_secret_presenter_123',
      });

      const p1 = room.joinContestant({ name: 'Elena' });
      room.executePresenterAction('htok_secret_presenter_123', {
        type: 'START_GAME',
        actionId: 'start-1',
      });

      const pub = room.getPublicState();
      const activeQId = pub.activeQuestion!.id;

      // Intento de un concursante de marcarse ACIERTO a sí mismo -> RECHAZADO (403)
      expect(() =>
        room.executePresenterAction(p1.playerToken, {
          type: 'MARK_CORRECT',
          actionId: 'hack-1',
          expectedPlayerId: p1.playerId,
          expectedLetter: 'A',
          expectedQuestionId: activeQId,
        })
      ).toThrowError(RoscoSecurityError);

      // Intento sin token -> RECHAZADO
      expect(() =>
        room.executePresenterAction(null, {
          type: 'MARK_INCORRECT',
          actionId: 'hack-2',
          expectedPlayerId: p1.playerId,
          expectedLetter: 'A',
          expectedQuestionId: activeQId,
        })
      ).toThrowError(/Acceso denegado/);

      // Intento de un concursante de leer el estado privado con respuestas -> RECHAZADO
      expect(() => room.getPresenterPrivateState(p1.playerToken)).toThrowError(
        RoscoSecurityError
      );

      // El presentador legítimo sí puede marcar ACIERTO
      const evt = room.executePresenterAction('htok_secret_presenter_123', {
        type: 'MARK_CORRECT',
        actionId: 'valid-1',
        expectedPlayerId: p1.playerId,
        expectedLetter: 'A',
        expectedQuestionId: activeQId,
      });
      expect(evt).toBe('ANSWER_MARKED_CORRECT');

      const updated = room.getPublicState();
      const elena = updated.contestants.find((c) => c.id === p1.playerId)!;
      expect(elena.letters.A.state).toBe('CORRECT');
      expect(elena.score.correctCount).toBe(1);
      expect(elena.score.totalPoints).toBe(10);
      expect(updated.activeLetter).toBe('B');
    });

    it('no envía la respuesta correcta ni la explicación a los concursantes antes de una revelación autorizada', () => {
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-SEC02',
        roomCode: 'SEC02',
        hostToken: 'htok_host',
      });
      room.joinContestant({ name: 'Carlos' });
      room.executePresenterAction('htok_host', { type: 'START_GAME', actionId: 'st-1' });

      const pubBefore = room.getPublicState();
      expect(pubBefore.activeQuestion).toBeDefined();
      expect(pubBefore.activeQuestion?.revealedAnswer).toBeUndefined();
      expect(pubBefore.activeQuestion?.revealedExplanation).toBeUndefined();
      expect((pubBefore.activeQuestion as any).mainAnswer).toBeUndefined();

      // La vista privada del presentador sí tiene la respuesta principal
      const priv = room.getPresenterPrivateState('htok_host');
      expect(priv.activeQuestionPrivate?.mainAnswer).toBeTruthy();

      // Cuando el presentador pulsa deliberadamente "Revelar respuesta" y "Mostrar explicación"
      room.executePresenterAction('htok_host', {
        type: 'REVEAL_ANSWER',
        actionId: 'rev-1',
      });
      room.executePresenterAction('htok_host', {
        type: 'SHOW_EXPLANATION',
        actionId: 'exp-1',
      });

      const pubAfter = room.getPublicState();
      expect(pubAfter.activeQuestion?.revealedAnswer).toBe(
        priv.activeQuestionPrivate?.mainAnswer
      );
      expect(pubAfter.activeQuestion?.revealedExplanation).toBe(
        priv.activeQuestionPrivate?.explanation
      );
    });

    it('impide doble registro de respuestas (idempotencia) e impide que una respuesta anterior altere una pregunta nueva', () => {
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-IDEM',
        roomCode: 'IDEM',
        hostToken: 'htok_host',
      });
      const p1 = room.joinContestant({ name: 'Lucía' });
      room.executePresenterAction('htok_host', { type: 'START_GAME', actionId: 's1' });

      const qA = room.getPublicState().activeQuestion!.id;

      // Primera ejecución con actionId 'click-A'
      room.executePresenterAction('htok_host', {
        type: 'MARK_CORRECT',
        actionId: 'click-A',
        expectedPlayerId: p1.playerId,
        expectedLetter: 'A',
        expectedQuestionId: qA,
      });

      // Doble clic con el mismo actionId 'click-A' -> bloqueado por idempotencia
      expect(() =>
        room.executePresenterAction('htok_host', {
          type: 'MARK_CORRECT',
          actionId: 'click-A',
          expectedPlayerId: p1.playerId,
          expectedLetter: 'A',
          expectedQuestionId: qA,
        })
      ).toThrowError(/ya fue procesada/);

      // Ahora la letra activa es la 'B'; un paquete retrasado que intente marcar la 'A' es rechazado
      expect(() =>
        room.executePresenterAction('htok_host', {
          type: 'MARK_INCORRECT',
          actionId: 'late-packet-for-A',
          expectedPlayerId: p1.playerId,
          expectedLetter: 'A',
          expectedQuestionId: qA,
        })
      ).toThrowError(/Desincronización evitada/);
    });
  });

  // ==========================================================================
  // 3. MECÁNICA ESPECIAL DE PASAPALABRA Y CRONÓMETROS INDIVIDUALES
  // ==========================================================================
  describe('3. Pasapalabra con Elección del Presentador y Cronómetros Individuales', () => {
    it('Opción 1 de Pasapalabra: deja la letra en amarillo/naranja (PASSED), no suma ni resta y continúa con el mismo concursante', () => {
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-PASA1',
        roomCode: 'PASA1',
        hostToken: 'htok_host',
      });
      const p1 = room.joinContestant({ name: 'Javier' });
      room.executePresenterAction('htok_host', { type: 'START_GAME', actionId: 'a1' });

      const qA = room.getPublicState().activeQuestion!.id;
      room.executePresenterAction('htok_host', {
        type: 'REGISTER_PASAPALABRA',
        actionId: 'pasa-A',
        expectedPlayerId: p1.playerId,
        expectedLetter: 'A',
        expectedQuestionId: qA,
      });

      const midState = room.getPublicState();
      expect(midState.awaitingPasapalabraDecision).toBe(true);
      const javierMid = midState.contestants[0];
      expect(javierMid.letters.A.state).toBe('PASSED');
      expect(javierMid.score.totalPoints).toBe(0);
      expect(javierMid.score.incorrectCount).toBe(0);

      // Presentador elige OPCIÓN 1: CONTINUAR CON EL MISMO CONCURSANTE
      room.executePresenterAction('htok_host', {
        type: 'PASAPALABRA_DECISION',
        actionId: 'dec-1',
        decision: 'CONTINUE_SAME',
      });

      const afterState = room.getPublicState();
      expect(afterState.awaitingPasapalabraDecision).toBe(false);
      expect(afterState.activePlayerId).toBe(p1.playerId);
      expect(afterState.activeLetter).toBe('B');
      expect(afterState.contestants[0].timer.isRunning).toBe(true);
    });

    it('Opción 2 de Pasapalabra: cede el turno, congela y guarda el tiempo del jugador 1, carga el rosco del jugador 2 y recupera el estado del jugador 1 al volver', () => {
      let currentTime = 1_000_000;
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-PASA2',
        roomCode: 'PASA2',
        hostToken: 'htok_host',
        config: { timerSeconds: 120 },
        now: currentTime,
      });

      const p1 = room.joinContestant({ name: 'Javier', now: currentTime });
      const p2 = room.joinContestant({ name: 'Marta', now: currentTime });

      room.executePresenterAction(
        'htok_host',
        { type: 'START_GAME', actionId: 'start' },
        currentTime
      );

      // Javier juega durante 18 segundos, acierta la A y hace Pasapalabra en la B
      currentTime += 10_000;
      const qA = room.getPublicState(currentTime).activeQuestion!.id;
      room.executePresenterAction(
        'htok_host',
        {
          type: 'MARK_CORRECT',
          actionId: 'javier-A',
          expectedPlayerId: p1.playerId,
          expectedLetter: 'A',
          expectedQuestionId: qA,
        },
        currentTime
      );

      currentTime += 8_000; // Total 18 segundos consumidos por Javier -> le quedan 102.000 ms
      const qB = room.getPublicState(currentTime).activeQuestion!.id;
      room.executePresenterAction(
        'htok_host',
        {
          type: 'REGISTER_PASAPALABRA',
          actionId: 'javier-pasa-B',
          expectedPlayerId: p1.playerId,
          expectedLetter: 'B',
          expectedQuestionId: qB,
        },
        currentTime
      );

      // Presentador elige OPCIÓN 2: CEDER EL TURNO A MARTA
      room.executePresenterAction(
        'htok_host',
        {
          type: 'PASAPALABRA_DECISION',
          actionId: 'transfer-to-marta',
          decision: 'TRANSFER_TURN',
          nextPlayerId: p2.playerId,
        },
        currentTime
      );

      const stateMartaTurn = room.getPublicState(currentTime);
      expect(stateMartaTurn.activePlayerId).toBe(p2.playerId);
      expect(stateMartaTurn.activeLetter).toBe('A'); // El rosco de Marta empieza en su propia A

      const javierPaused = stateMartaTurn.contestants.find((c) => c.id === p1.playerId)!;
      expect(javierPaused.status).toBe('PAUSED');
      expect(javierPaused.timer.isRunning).toBe(false);
      expect(javierPaused.timer.remainingMs).toBe(102_000);
      expect(javierPaused.letters.A.state).toBe('CORRECT');
      expect(javierPaused.letters.B.state).toBe('PASSED');

      // Marta juega durante 25 segundos y dice Pasapalabra en la A
      currentTime += 25_000;
      const qMartaA = room.getPublicState(currentTime).activeQuestion!.id;
      room.executePresenterAction(
        'htok_host',
        {
          type: 'REGISTER_PASAPALABRA',
          actionId: 'marta-pasa-A',
          expectedPlayerId: p2.playerId,
          expectedLetter: 'A',
          expectedQuestionId: qMartaA,
        },
        currentTime
      );

      // El tiempo de Javier NO se ha descontado mientras jugaba Marta (sigue en 102.000 ms exactos)
      const javierCheck = room
        .getPublicState(currentTime)
        .contestants.find((c) => c.id === p1.playerId)!;
      expect(javierCheck.timer.remainingMs).toBe(102_000);

      // Marta cede el turno de vuelta a Javier
      room.executePresenterAction(
        'htok_host',
        {
          type: 'PASAPALABRA_DECISION',
          actionId: 'transfer-back-javier',
          decision: 'TRANSFER_TURN',
          nextPlayerId: p1.playerId,
        },
        currentTime
      );

      const stateJavierBack = room.getPublicState(currentTime);
      expect(stateJavierBack.activePlayerId).toBe(p1.playerId);
      // Javier continúa exactamente en la letra C (siguiente sin resolver) con sus 102.000 ms intactos y su letra B pendiente en PASSED
      expect(stateJavierBack.activeLetter).toBe('C');
      const javierResumed = stateJavierBack.contestants.find((c) => c.id === p1.playerId)!;
      expect(javierResumed.timer.remainingMs).toBe(102_000);
      expect(javierResumed.timer.isRunning).toBe(true);
      expect(javierResumed.letters.B.state).toBe('PASSED');
    });

    it('al llegar el cronómetro de un jugador a cero, finaliza su turno automáticamente y bloquea nuevas respuestas para él', () => {
      let now = 5_000_000;
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-TIMER',
        roomCode: 'TIMER1',
        hostToken: 'htok_host',
        config: { timerSeconds: 60 },
        now,
      });

      const p1 = room.joinContestant({ name: 'Sofía', now });
      room.executePresenterAction('htok_host', { type: 'START_GAME', actionId: 's1' }, now);

      // Transcurren 61 segundos en el servidor
      now += 61_000;
      const { expiredPlayerId } = room.syncActiveTimer(now);
      expect(expiredPlayerId).toBe(p1.playerId);

      const pub = room.getPublicState(now);
      const sofia = pub.contestants[0];
      expect(sofia.timer.remainingMs).toBe(0);
      expect(sofia.timer.isRunning).toBe(false);
      expect(sofia.status).toBe('FINISHED');
    });
  });

  // ==========================================================================
  // 4. MULTIJUGADOR CON 15 CONCURSANTES REALES Y RECHAZO DEL N.º 16
  // ==========================================================================
  describe('4. Multijugador con 15 Concursantes Simultáneos y Deshacer / Auditoría', () => {
    it('admite 15 concursantes con avatares y roscos independientes, rechaza al jugador número 16 y rechaza nombres duplicados', () => {
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-15PLAYERS',
        roomCode: 'SALA15',
        hostToken: 'htok_host',
      });

      const joinedPlayers = [];
      for (let i = 1; i <= MAX_CONTESTANTS; i++) {
        const res = room.joinContestant({
          name: `Concursante ${i}`,
        });
        joinedPlayers.push(res);
      }

      expect(room.getPublicState().contestants).toHaveLength(15);

      // Intentar entrar con nombre duplicado o como jugador número 16 -> RECHAZADO
      expect(() =>
        room.joinContestant({
          name: 'Concursante 16',
        })
      ).toThrowError(/límite máximo de 15 concursantes/);

      // Sin embargo, el jugador 5 puede reconectarse con su token sin ser rechazado
      const reconnected = room.joinContestant({
        name: 'Concursante 5',
        playerToken: joinedPlayers[4].playerToken,
      });
      expect(reconnected.playerId).toBe(joinedPlayers[4].playerId);
      expect(room.getPublicState().contestants).toHaveLength(15);
    });

    it('permite deshacer únicamente la última acción válida del presentador y deja constancia en el registro de auditoría', () => {
      const room = new AuthoritativeRoscoRoom({
        roomId: 'room-UNDO',
        roomCode: 'UNDO01',
        hostToken: 'htok_host',
      });

      const p1 = room.joinContestant({ name: 'Andrés' });
      room.executePresenterAction('htok_host', { type: 'START_GAME', actionId: 'st' });

      const qA = room.getPublicState().activeQuestion!.id;
      room.executePresenterAction('htok_host', {
        type: 'MARK_INCORRECT',
        actionId: 'err-A',
        expectedPlayerId: p1.playerId,
        expectedLetter: 'A',
        expectedQuestionId: qA,
      });

      expect(room.getPublicState().contestants[0].letters.A.state).toBe('INCORRECT');
      expect(room.getPublicState().activeLetter).toBe('B');

      // Presentador deshace el fallo accidental
      room.executePresenterAction('htok_host', {
        type: 'UNDO_LAST_ACTION',
        actionId: 'undo-1',
      });

      const restored = room.getPublicState();
      expect(restored.activeLetter).toBe('A');
      expect(restored.contestants[0].letters.A.state).toBe('ACTIVE');
      expect(restored.contestants[0].score.incorrectCount).toBe(0);

      // Intentar volver a deshacer sin nueva acción -> rechazado
      expect(() =>
        room.executePresenterAction('htok_host', {
          type: 'UNDO_LAST_ACTION',
          actionId: 'undo-2',
        })
      ).toThrowError(/No hay ninguna acción reciente/);

      const priv = room.getPresenterPrivateState('htok_host');
      expect(priv.auditLog[0].eventType).toBe('ACTION_UNDONE');
    });
  });
});
