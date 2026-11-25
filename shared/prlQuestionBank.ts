import { PRL_QUESTIONS_PART_1 } from './prlQuestionsPart1';
import { PRL_QUESTIONS_PART_2 } from './prlQuestionsPart2';
import {
  PRLCategory,
  PRLQuestion,
  PublicQuestionView,
  QuestionDifficulty,
  ROSCO_LETTERS,
  RoscoLetter,
} from './types';

// ============================================================================
// BANCO UNIFICADO Y SELECTOR DE 27 PREGUNTAS (135 PREGUNTAS VERIFICADAS)
// ============================================================================

export const INITIAL_PRL_QUESTION_BANK: PRLQuestion[] = [
  ...PRL_QUESTIONS_PART_1,
  ...PRL_QUESTIONS_PART_2,
];

/**
 * Agrupa un banco de preguntas por letra (A-Z incluyendo Ñ)
 */
export function groupQuestionsByLetter(
  bank: PRLQuestion[] = INITIAL_PRL_QUESTION_BANK
): Record<RoscoLetter, PRLQuestion[]> {
  const grouped = {} as Record<RoscoLetter, PRLQuestion[]>;
  for (const letter of ROSCO_LETTERS) {
    grouped[letter] = [];
  }
  for (const q of bank) {
    if (q.isActive !== false && grouped[q.letter]) {
      grouped[q.letter].push(q);
    }
  }
  return grouped;
}

/**
 * Selecciona un rosco completo de 27 preguntas (1 por cada letra del abecedario español)
 * respetando filtros de categoría y dificultad cuando haya alternativas disponibles,
 * y evitando repetir preguntas usadas en partidas anteriores consecutivas (`previouslyUsedIds`).
 */
export function selectRoundQuestions(options?: {
  bank?: PRLQuestion[];
  categories?: PRLCategory[];
  difficulty?: 'TODAS' | QuestionDifficulty;
  previouslyUsedIds?: Set<string> | string[];
  randomFn?: () => number;
}): Record<RoscoLetter, PRLQuestion> {
  const bank = options?.bank ?? INITIAL_PRL_QUESTION_BANK;
  const categoriesSet =
    options?.categories && options.categories.length > 0
      ? new Set(options.categories)
      : null;
  const difficulty = options?.difficulty && options.difficulty !== 'TODAS' ? options.difficulty : null;
  const usedSet =
    options?.previouslyUsedIds instanceof Set
      ? options.previouslyUsedIds
      : new Set(options?.previouslyUsedIds ?? []);
  const rand = options?.randomFn ?? Math.random;

  const grouped = groupQuestionsByLetter(bank);
  const selected = {} as Record<RoscoLetter, PRLQuestion>;

  for (const letter of ROSCO_LETTERS) {
    const allForLetter = grouped[letter] || [];
    if (allForLetter.length === 0) {
      throw new Error(`No hay preguntas disponibles para la letra ${letter}`);
    }

    // 1. Filtrar por categoría y dificultad seleccionadas
    let candidates = allForLetter.filter((q) => {
      const catMatch = !categoriesSet || categoriesSet.has(q.category);
      const diffMatch = !difficulty || q.difficulty === difficulty;
      return catMatch && diffMatch;
    });

    // Si el filtro estricto deja la letra sin candidatas, relajar gradualmente para garantizar las 27 letras
    if (candidates.length === 0 && categoriesSet) {
      candidates = allForLetter.filter((q) => categoriesSet.has(q.category));
    }
    if (candidates.length === 0 && difficulty) {
      candidates = allForLetter.filter((q) => q.difficulty === difficulty);
    }
    if (candidates.length === 0) {
      candidates = allForLetter;
    }

    // 2. Evitar repetir preguntas de partidas anteriores consecutivas si hay alternativas frescas
    const freshCandidates = candidates.filter((q) => !usedSet.has(q.id));
    const finalPool = freshCandidates.length > 0 ? freshCandidates : candidates;

    const chosenIndex = Math.floor(rand() * finalPool.length);
    selected[letter] = finalPool[chosenIndex];
  }

  return selected;
}

/**
 * Sanitiza una pregunta de PRL para su envío seguro a los concursantes.
 * NUNCA incluye mainAnswer, acceptedVariants, synonyms ni explanation
 * salvo que el presentador haya autorizado explícitamente su revelación.
 */
export function toPublicQuestionView(
  question: PRLQuestion,
  revealOptions?: {
    revealAnswer?: boolean;
    revealExplanation?: boolean;
  }
): PublicQuestionView {
  const view: PublicQuestionView = {
    id: question.id,
    letter: question.letter,
    mode: question.mode,
    statement: question.statement,
    category: question.category,
    difficulty: question.difficulty,
  };

  if (revealOptions?.revealAnswer) {
    view.revealedAnswer = question.mainAnswer;
    view.revealedVariants = [...question.acceptedVariants, ...question.synonyms];
  }

  if (revealOptions?.revealExplanation) {
    view.revealedExplanation = question.explanation;
    view.revealedSource = question.source;
    view.revealedSourceUrl = question.sourceUrl;
  }

  return view;
}

/**
 * Normaliza texto en español (conservando la diferencia con Ñ pero ignorando tildes y mayúsculas)
 */
export function normalizeSpanishText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ñ/g, '__enie__')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/__enie__/g, 'ñ')
    .replace(/\s+/g, ' ');
}
