import React, { useEffect, useMemo, useState } from 'react';
import { X, Plus, Search, Save, BookOpen, ExternalLink } from 'lucide-react';
import {
  PRL_CATEGORIES,
  PRLCategory,
  PRLQuestion,
  QuestionDifficulty,
  QuestionMode,
  ROSCO_LETTERS,
  RoscoLetter,
} from '../../../shared/types';
import { INITIAL_PRL_QUESTION_BANK } from '../../../shared/prlQuestionBank';
import { useRoscoStore } from '../../store/useRoscoStore';

interface QuestionBankAdminModalProps {
  onClose: () => void;
}

export const QuestionBankAdminModal: React.FC<QuestionBankAdminModalProps> = ({ onClose }) => {
  const { questionBank, fetchQuestionBank, saveQuestionInBank } = useRoscoStore();
  const [filterLetter, setFilterLetter] = useState<'TODAS' | RoscoLetter>('TODAS');
  const [filterCategory, setFilterCategory] = useState<'TODAS' | PRLCategory>('TODAS');
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState<PRLQuestion | null>(null);
  const [variantsInput, setVariantsInput] = useState('');
  const [synonymsInput, setSynonymsInput] = useState('');
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestionBank();
  }, [fetchQuestionBank]);

  const effectiveBank = questionBank.length > 0 ? questionBank : INITIAL_PRL_QUESTION_BANK;

  const filteredQuestions = useMemo(() => {
    return effectiveBank.filter((q) => {
      if (filterLetter !== 'TODAS' && q.letter !== filterLetter) return false;
      if (filterCategory !== 'TODAS' && q.category !== filterCategory) return false;
      if (searchQuery.trim() !== '') {
        const term = searchQuery.toLowerCase();
        return (
          q.statement.toLowerCase().includes(term) ||
          q.mainAnswer.toLowerCase().includes(term) ||
          q.category.toLowerCase().includes(term) ||
          q.source.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [effectiveBank, filterLetter, filterCategory, searchQuery]);

  const startNewQuestion = () => {
    const defaultLetter: RoscoLetter = filterLetter === 'TODAS' ? 'A' : filterLetter;
    const newQ: PRLQuestion = {
      id: `PRL-${defaultLetter}-${Date.now().toString().slice(-4)}`,
      letter: defaultLetter,
      mode: defaultLetter === 'Ñ' ? 'CONTIENE' : 'EMPIEZA_POR',
      statement: '',
      mainAnswer: '',
      acceptedVariants: [],
      synonyms: [],
      explanation: '',
      category: 'Seguridad en el trabajo',
      difficulty: 'MEDIA',
      source: 'Ley 31/1995 de Prevención de Riesgos Laborales (BOE)',
      sourceUrl: 'https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292',
      reviewedAt: new Date().toISOString().slice(0, 10),
    };
    setEditing(newQ);
    setVariantsInput('');
    setSynonymsInput('');
  };

  const startEditQuestion = (q: PRLQuestion) => {
    setEditing({ ...q });
    setVariantsInput(q.acceptedVariants.join(', '));
    setSynonymsInput(q.synonyms.join(', '));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const toSave: PRLQuestion = {
      ...editing,
      acceptedVariants: variantsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      synonyms: synonymsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const ok = await saveQuestionInBank(toSave);
    if (ok) {
      setSavedNotice(`Pregunta ${toSave.id} (${toSave.letter}) guardada correctamente.`);
      setEditing(null);
      setTimeout(() => setSavedNotice(null), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-6xl max-h-[90vh] bg-studio-900 border-2 border-blue-400/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Cabecera */}
        <div className="px-5 py-4 bg-studio-950/90 border-b border-blue-400/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="w-6 h-6 text-amber-400" />
            <div>
              <h2 className="font-display font-black text-lg sm:text-xl text-white">
                BANCO OFICIAL DE PREGUNTAS DE PRL ({effectiveBank.length} PREGUNTAS)
              </h2>
              <p className="text-xs text-blue-200">
                27 letras (incluida Ñ) · 24 categorías · Referencias normativas BOE e INSST
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startNewQuestion}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-1.5 shadow"
            >
              <Plus className="w-4 h-4" />
              Nueva Pregunta PRL
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {savedNotice && (
          <div className="px-5 py-2 bg-emerald-600/30 border-b border-emerald-400/40 text-emerald-200 text-xs font-bold">
            {savedNotice}
          </div>
        )}

        {/* Formulario de edición / creación si está activo */}
        {editing ? (
          <form onSubmit={handleSave} className="p-5 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between border-b border-blue-400/20 pb-2">
              <h3 className="font-display font-bold text-base text-amber-300">
                Editar / Crear Pregunta ({editing.id})
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-xs text-slate-300 hover:text-white"
              >
                Volver al listado
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">Letra (A-Z, Ñ)</label>
                <select
                  value={editing.letter}
                  onChange={(e) =>
                    setEditing({ ...editing, letter: e.target.value as RoscoLetter })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                >
                  {ROSCO_LETTERS.map((l) => (
                    <option key={l} value={l}>
                      Letra {l}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">Modalidad</label>
                <select
                  value={editing.mode}
                  onChange={(e) =>
                    setEditing({ ...editing, mode: e.target.value as QuestionMode })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                >
                  <option value="EMPIEZA_POR">EMPIEZA POR</option>
                  <option value="CONTIENE">CONTIENE</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">Categoría PRL</label>
                <select
                  value={editing.category}
                  onChange={(e) =>
                    setEditing({ ...editing, category: e.target.value as PRLCategory })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                >
                  {PRL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">Dificultad</label>
                <select
                  value={editing.difficulty}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      difficulty: e.target.value as QuestionDifficulty,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                >
                  <option value="FACIL">FÁCIL</option>
                  <option value="MEDIA">MEDIA</option>
                  <option value="DIFICIL">DIFÍCIL</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-blue-200 mb-1">
                Enunciado de la pregunta
              </label>
              <textarea
                required
                rows={2}
                value={editing.statement}
                onChange={(e) => setEditing({ ...editing, statement: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-emerald-300 mb-1">
                  Respuesta Principal Correcta
                </label>
                <input
                  required
                  type="text"
                  value={editing.mainAnswer}
                  onChange={(e) => setEditing({ ...editing, mainAnswer: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-emerald-400/50 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">
                  Variantes aceptadas (separadas por coma)
                </label>
                <input
                  type="text"
                  value={variantsInput}
                  onChange={(e) => setVariantsInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">
                  Sinónimos autorizados (separados por coma)
                </label>
                <input
                  type="text"
                  value={synonymsInput}
                  onChange={(e) => setSynonymsInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-blue-200 mb-1">
                Explicación técnica de PRL
              </label>
              <textarea
                required
                rows={2}
                value={editing.explanation}
                onChange={(e) => setEditing({ ...editing, explanation: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">
                  Fuente normativa / técnica (BOE / INSST)
                </label>
                <input
                  required
                  type="text"
                  value={editing.source}
                  onChange={(e) => setEditing({ ...editing, source: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-blue-200 mb-1">
                  URL Oficial (BOE / INSST)
                </label>
                <input
                  required
                  type="url"
                  value={editing.sourceUrl}
                  onChange={(e) => setEditing({ ...editing, sourceUrl: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-studio-950 border border-blue-400/40 text-sm text-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-xs font-bold text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white flex items-center gap-1.5 shadow"
              >
                <Save className="w-4 h-4" />
                Guardar en el Banco PRL
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Barra de filtros por las 27 letras, categoría y búsqueda */}
            <div className="p-4 bg-studio-950/60 border-b border-blue-400/20 space-y-3">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setFilterLetter('TODAS')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                    filterLetter === 'TODAS'
                      ? 'bg-blue-600 text-white'
                      : 'bg-studio-800 text-blue-200 hover:bg-studio-700'
                  }`}
                >
                  TODAS (27)
                </button>
                {ROSCO_LETTERS.map((letter) => (
                  <button
                    key={letter}
                    type="button"
                    onClick={() => setFilterLetter(letter)}
                    className={`w-7 h-7 rounded-lg text-xs font-display font-black transition ${
                      filterLetter === letter
                        ? 'bg-blue-500 text-white shadow-rosco-blue scale-110'
                        : 'bg-studio-800 text-blue-200 hover:bg-studio-700'
                    }`}
                  >
                    {letter}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-blue-300 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Buscar por concepto, respuesta, RD o categoría..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-studio-950 border border-blue-400/30 text-xs text-white"
                  />
                </div>

                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value as any)}
                  className="px-3 py-1.5 rounded-lg bg-studio-950 border border-blue-400/30 text-xs text-white"
                >
                  <option value="TODAS">Todas las categorías PRL (24)</option>
                  {PRL_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Listado de preguntas */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {filteredQuestions.map((q) => (
                <div
                  key={q.id}
                  className="p-3.5 rounded-xl bg-studio-950/75 border border-blue-400/25 hover:border-blue-400/60 transition flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center font-display font-black text-base text-white shrink-0 shadow-rosco-blue">
                      {q.letter}
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded bg-blue-500/25 border border-blue-400/40 text-[10px] font-bold text-blue-200">
                          {q.mode === 'EMPIEZA_POR'
                            ? `EMPIEZA POR ${q.letter}`
                            : `CONTIENE LA ${q.letter}`}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-400/40 text-xs font-bold text-emerald-300">
                          Respuesta: {q.mainAnswer}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-studio-800 text-[10px] text-blue-200">
                          {q.category}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-[10px] font-bold text-amber-300">
                          {q.difficulty}
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-white font-medium">{q.statement}</p>
                      <p className="text-[11px] text-slate-300">{q.explanation}</p>
                      <div className="flex items-center gap-2 text-[10px] text-blue-300">
                        <span>Fuente: {q.source}</span>
                        <a
                          href={q.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 underline hover:text-white"
                        >
                          BOE/INSST <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => startEditQuestion(q)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600 border border-blue-400/40 text-xs font-bold text-white shrink-0 transition"
                  >
                    Editar
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
