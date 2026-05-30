"use client";

import { useEffect, useState } from "react";
import { explainQuestion, getQuiz, submitAnswer } from "@/app/actions";
import { btnPrimary, btnSecondary, PageTitle, TopicSelect } from "@/components/ui";
import { celebrate } from "@/lib/confetti";
import { CODE_TO_NAME } from "@/lib/topics";
import type { Question } from "@/lib/types";

interface QuizState {
  questions: Question[];
  idx: number;
  answers: Record<number, string>;
  submitted: Record<number, boolean>;
  correct: number;
}

const CHOICES = ["A", "B", "C"] as const;

export default function QuizPage() {
  const [topic, setTopic] = useState("ALL");
  const [n, setN] = useState(10);
  const [quiz, setQuiz] = useState<QuizState | null>(null);
  const [done, setDone] = useState(false);
  const [starting, setStarting] = useState(false);
  const [warn, setWarn] = useState("");
  const [ai, setAi] = useState<
    Record<number, { loading?: boolean; text?: string; error?: string }>
  >({});

  // Celebrate finishing a quiz (bigger burst for a strong score).
  useEffect(() => {
    if (done && quiz) {
      const ratio = quiz.correct / quiz.questions.length;
      celebrate({ particles: ratio >= 0.8 ? 260 : 160 });
    }
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setStarting(true);
    setWarn("");
    try {
      const qs = await getQuiz(topic === "ALL" ? null : topic, n);
      if (qs.length === 0) {
        setWarn("No questions found for that filter. Add some in Manage.");
        return;
      }
      setQuiz({ questions: qs, idx: 0, answers: {}, submitted: {}, correct: 0 });
      setDone(false);
    } finally {
      setStarting(false);
    }
  }

  function reset() {
    setQuiz(null);
    setDone(false);
  }

  // ---- setup screen ----
  if (!quiz) {
    return (
      <>
        <PageTitle>📝 Quiz</PageTitle>
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm text-slate-600">Set up a practice set:</p>
          <label className="mb-1 block text-xs font-medium text-slate-500">Topic</label>
          <TopicSelect value={topic} onChange={setTopic} />
          <label className="mb-1 mt-4 block text-xs font-medium text-slate-500">
            Number of questions
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={n}
            onChange={(e) =>
              setN(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={start}
            disabled={starting}
            className={`mt-5 w-full ${btnPrimary}`}
          >
            {starting ? "Loading…" : "Start quiz"}
          </button>
          {warn && <p className="mt-3 text-sm text-amber-600">{warn}</p>}
        </div>
      </>
    );
  }

  const { questions, idx, answers, submitted, correct } = quiz;
  const total = questions.length;
  const q = questions[idx];
  const isSubmitted = submitted[idx] ?? false;
  const answered = Object.keys(submitted).length;

  // ---- results screen ----
  if (done) {
    const breakdown: Record<string, [number, number]> = {};
    questions.forEach((qq, i) => {
      const code = qq.topic_code;
      breakdown[code] ??= [0, 0];
      breakdown[code][1] += 1;
      if (answers[i] === qq.correct) breakdown[code][0] += 1;
    });
    return (
      <>
        <PageTitle>📝 Quiz — Result</PageTitle>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-3xl font-bold text-slate-900">
            {correct}/{total}{" "}
            <span className="text-lg font-medium text-slate-500">
              ({Math.round((correct / total) * 100)}%)
            </span>
          </div>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-700">
            Per-topic breakdown
          </h3>
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Topic</th>
                  <th className="px-4 py-2 font-medium">Correct</th>
                  <th className="px-4 py-2 font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Accuracy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(breakdown).map(([code, [c, t]]) => (
                  <tr key={code}>
                    <td className="px-4 py-2 font-medium">{code}</td>
                    <td className="px-4 py-2 text-slate-600">{c}</td>
                    <td className="px-4 py-2 text-slate-600">{t}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {Math.round((c / t) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={reset} className={`mt-6 ${btnPrimary}`}>
            New quiz
          </button>
        </div>
      </>
    );
  }

  // ---- question screen ----
  const choiceText: Record<string, string> = {
    A: q.choice_a,
    B: q.choice_b,
    C: q.choice_c,
  };
  const chosen = answers[idx];

  function choose(letter: string) {
    if (isSubmitted) return;
    setQuiz((prev) =>
      prev ? { ...prev, answers: { ...prev.answers, [idx]: letter } } : prev,
    );
  }

  async function submit() {
    if (!chosen || isSubmitted) return;
    const isCorrect = chosen === q.correct;
    setQuiz((prev) =>
      prev
        ? {
            ...prev,
            submitted: { ...prev.submitted, [idx]: true },
            correct: prev.correct + (isCorrect ? 1 : 0),
          }
        : prev,
    );
    submitAnswer(q.id, q.topic_id, chosen, isCorrect).catch(() => {});
  }

  function go(delta: number) {
    setQuiz((prev) =>
      prev ? { ...prev, idx: Math.max(0, Math.min(total - 1, prev.idx + delta)) } : prev,
    );
  }

  async function explain() {
    if (ai[idx]?.text || ai[idx]?.loading) return;
    setAi((m) => ({ ...m, [idx]: { loading: true } }));
    const res = await explainQuestion(
      q.stem,
      { a: q.choice_a, b: q.choice_b, c: q.choice_c },
      q.correct,
      chosen ?? null,
    );
    setAi((m) => ({ ...m, [idx]: { loading: false, ...res } }));
  }

  return (
    <>
      <PageTitle>📝 Quiz</PageTitle>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>
            Question {idx + 1} of {total}
          </span>
          <span>
            Score {correct}/{answered}
          </span>
        </div>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${(idx / total) * 100}%` }}
          />
        </div>

        <div className="mb-1 text-xs text-slate-500">
          {q.topic_code} — {CODE_TO_NAME[q.topic_code]}
        </div>
        <div className="mb-5 text-lg font-medium text-slate-900">{q.stem}</div>

        <div className="flex flex-col gap-2">
          {CHOICES.map((letter) => {
            const selected = chosen === letter;
            const correctChoice = isSubmitted && letter === q.correct;
            const wrongChoice = isSubmitted && selected && letter !== q.correct;
            return (
              <button
                key={letter}
                onClick={() => choose(letter)}
                disabled={isSubmitted}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                  correctChoice
                    ? "border-emerald-300 bg-emerald-50"
                    : wrongChoice
                      ? "border-rose-300 bg-rose-50"
                      : selected
                        ? "border-indigo-400 bg-indigo-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                } ${isSubmitted ? "cursor-default" : ""}`}
              >
                <span className="font-semibold text-slate-500">{letter}.</span>
                <span className="text-slate-800">{choiceText[letter]}</span>
              </button>
            );
          })}
        </div>

        {!isSubmitted ? (
          <button
            onClick={submit}
            disabled={!chosen}
            className={`mt-5 ${btnPrimary}`}
          >
            Submit answer
          </button>
        ) : (
          <>
            <div
              className={`mt-5 rounded-lg p-3 text-sm ${
                chosen === q.correct
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-rose-50 text-rose-800"
              }`}
            >
              {chosen === q.correct
                ? `✅ Correct — ${q.correct}. ${choiceText[q.correct]}`
                : `❌ You chose ${chosen}. Correct: ${q.correct}. ${choiceText[q.correct]}`}
            </div>
            {q.explanation && (
              <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                {q.explanation}
              </div>
            )}

            <div className="mt-3">
              {!ai[idx]?.text && !ai[idx]?.loading && (
                <button
                  onClick={explain}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                >
                  🤖 Explain with AI
                </button>
              )}
              {ai[idx]?.loading && <p className="text-sm text-slate-500">🤖 Thinking…</p>}
              {ai[idx]?.text && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-slate-700">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-indigo-500">
                    🤖 AI explanation
                  </div>
                  <p className="whitespace-pre-wrap">{ai[idx]?.text}</p>
                </div>
              )}
              {ai[idx]?.error && <p className="text-sm text-amber-600">{ai[idx]?.error}</p>}
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {idx > 0 && (
                <button onClick={() => go(-1)} className={btnSecondary}>
                  ⬅ Previous
                </button>
              )}
              {idx < total - 1 ? (
                <button onClick={() => go(1)} className={btnPrimary}>
                  Next ➡
                </button>
              ) : (
                <button onClick={() => setDone(true)} className={btnPrimary}>
                  Finish ✅
                </button>
              )}
              <button onClick={reset} className={btnSecondary}>
                End quiz
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
