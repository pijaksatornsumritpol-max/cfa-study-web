"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSimulationHistory,
  saveSimulation,
  simulationAvailability,
  startSimulation,
} from "@/app/actions";
import { btnPrimary, btnSecondary, PageTitle } from "@/components/ui";
import { celebrate } from "@/lib/confetti";
import { CODE_TO_NAME, TOPICS } from "@/lib/topics";
import type { ExamAttempt } from "@/lib/db";
import type { Question } from "@/lib/types";

const EXAM_N = 90; // one CFA Level I session
const EXAM_SECONDS = 135 * 60; // 2h 15m
const MPS = 70; // approximate passing-guide score

type Phase = "setup" | "running" | "result";
const CHOICES = ["A", "B", "C"] as const;

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function SimulationPage() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [avail, setAvail] = useState<{
    total: number;
    byTopic: Record<string, number>;
  } | null>(null);
  const [history, setHistory] = useState<ExamAttempt[] | null>(null);
  const [loadingStart, setLoadingStart] = useState(false);

  // running state
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [idx, setIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(EXAM_SECONDS);
  const startRef = useRef<number>(0);

  // result
  const [result, setResult] = useState<null | {
    total: number;
    correct: number;
    breakdown: Record<string, [number, number]>;
    durationSec: number;
  }>(null);

  // refs to avoid stale closures inside the timer
  const answersRef = useRef<Record<number, string>>({});
  const questionsRef = useRef<Question[]>([]);
  const savedRef = useRef(false);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const loadSetup = useCallback(() => {
    simulationAvailability()
      .then(setAvail)
      .catch(() => setAvail({ total: 0, byTopic: {} }));
    getSimulationHistory()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);
  useEffect(() => {
    loadSetup();
  }, [loadSetup]);

  const finish = useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    const qs = questionsRef.current;
    const ans = answersRef.current;
    let correct = 0;
    const breakdown: Record<string, [number, number]> = {};
    qs.forEach((q, i) => {
      breakdown[q.topic_code] ??= [0, 0];
      breakdown[q.topic_code][1] += 1;
      if (ans[i] === q.correct) {
        correct += 1;
        breakdown[q.topic_code][0] += 1;
      }
    });
    const durationSec = Math.round((Date.now() - startRef.current) / 1000);
    setResult({ total: qs.length, correct, breakdown, durationSec });
    setPhase("result");
    saveSimulation({
      started_at: new Date(startRef.current).toISOString(),
      finished_at: new Date().toISOString(),
      duration_sec: durationSec,
      total: qs.length,
      correct,
      breakdown,
    })
      .then(() => getSimulationHistory().then(setHistory).catch(() => {}))
      .catch(() => {});
    celebrate({ particles: qs.length && correct / qs.length >= 0.7 ? 240 : 140 });
  }, []);

  // Countdown timer (auto-submits at zero).
  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          finish();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase, finish]);

  async function start() {
    setLoadingStart(true);
    try {
      const qs = await startSimulation(EXAM_N);
      if (!qs.length) return;
      questionsRef.current = qs;
      answersRef.current = {};
      savedRef.current = false;
      setQuestions(qs);
      setAnswers({});
      setFlagged(new Set());
      setIdx(0);
      setSecondsLeft(EXAM_SECONDS);
      startRef.current = Date.now();
      setResult(null);
      setPhase("running");
    } finally {
      setLoadingStart(false);
    }
  }

  // ---------------- SETUP ----------------
  if (phase === "setup") {
    return (
      <>
        <PageTitle>🎯 Exam Simulation</PageTitle>
        <div className="max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">
            A timed mock session like the real CFA Level I exam:{" "}
            <strong className="text-slate-800">{EXAM_N} questions</strong> in{" "}
            <strong className="text-slate-800">2h 15m</strong>, drawn across topics by
            their official exam weights. You can flag questions and revisit them; the
            exam auto-submits when time runs out.
          </p>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="mb-1 flex justify-between">
              <span className="text-slate-500">Questions in bank</span>
              <span className="font-semibold text-slate-800">{avail?.total ?? "—"}</span>
            </div>
            {avail && avail.total < EXAM_N && (
              <p className="text-xs text-amber-600">
                Bank has fewer than {EXAM_N} questions — the exam will use{" "}
                {avail.total} for now. More appear as the question bank grows.
              </p>
            )}
            {avail && avail.total > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {TOPICS.map((t) => (
                  <span
                    key={t.code}
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      (avail.byTopic[t.code] ?? 0) > 0
                        ? "bg-indigo-50 text-indigo-700"
                        : "bg-slate-100 text-slate-400"
                    }`}
                    title={CODE_TO_NAME[t.code]}
                  >
                    {t.code} {avail.byTopic[t.code] ?? 0}
                  </span>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={start}
            disabled={loadingStart || !avail || avail.total === 0}
            className={`mt-5 w-full ${btnPrimary}`}
          >
            {loadingStart ? "Building exam…" : `Start ${EXAM_N}-question exam`}
          </button>
        </div>

        <History history={history} />
      </>
    );
  }

  // ---------------- RESULT ----------------
  if (phase === "result" && result) {
    const pct = result.total ? Math.round((result.correct / result.total) * 100) : 0;
    const pass = pct >= MPS;
    return (
      <>
        <PageTitle>🎯 Exam Result</PageTitle>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="text-4xl font-bold text-slate-900">
                {result.correct}/{result.total}{" "}
                <span className="text-xl font-medium text-slate-500">({pct}%)</span>
              </div>
              <div
                className={`mt-1 inline-block rounded-full px-3 py-0.5 text-sm font-semibold ${
                  pass
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                {pass ? "✅ Above ~70% guide" : "⚠ Below ~70% guide"}
              </div>
            </div>
            <span className="grow" />
            <div className="text-right text-sm text-slate-500">
              Time used
              <div className="text-lg font-semibold text-slate-800">
                {fmt(result.durationSec)}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            ~70% is only a rough study guide — CFA Institute does not publish the minimum
            passing score.
          </p>

          <h3 className="mb-2 mt-6 text-sm font-semibold text-slate-700">
            Per-topic breakdown
          </h3>
          <BreakdownTable breakdown={result.breakdown} />

          <div className="mt-6 flex flex-wrap gap-2">
            <button onClick={() => setPhase("setup")} className={btnPrimary}>
              🔁 New exam
            </button>
          </div>
        </div>

        <History history={history} />
      </>
    );
  }

  // ---------------- RUNNING ----------------
  const q = questions[idx];
  const answeredCount = Object.keys(answers).length;
  const lowTime = secondsLeft <= 300;

  function choose(letter: string) {
    setAnswers((a) => ({ ...a, [idx]: letter }));
  }
  function toggleFlag() {
    setFlagged((f) => {
      const n = new Set(f);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }
  function go(d: number) {
    setIdx((i) => Math.max(0, Math.min(questions.length - 1, i + d)));
  }

  return (
    <>
      {/* sticky timer / progress bar */}
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="text-sm text-slate-500">
          Answered{" "}
          <span className="font-semibold text-slate-800">{answeredCount}</span>/
          {questions.length}
          {flagged.size > 0 && (
            <span className="ml-2 text-amber-600">🚩 {flagged.size}</span>
          )}
        </div>
        <div
          className={`rounded-lg px-3 py-1 font-mono text-lg font-bold ${
            lowTime ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-800"
          }`}
        >
          ⏱ {fmt(secondsLeft)}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>
            Question {idx + 1} of {questions.length}
          </span>
          <span>
            {q.topic_code} — {CODE_TO_NAME[q.topic_code]}
          </span>
        </div>
        <div className="mb-5 mt-2 text-lg font-medium text-slate-900">{q.stem}</div>

        <div className="flex flex-col gap-2">
          {CHOICES.map((letter) => {
            const text: Record<string, string> = {
              A: q.choice_a,
              B: q.choice_b,
              C: q.choice_c,
            };
            const selected = answers[idx] === letter;
            return (
              <button
                key={letter}
                onClick={() => choose(letter)}
                className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                  selected
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="font-semibold text-slate-500">{letter}.</span>
                <span className="text-slate-800">{text[letter]}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button onClick={() => go(-1)} disabled={idx === 0} className={btnSecondary}>
            ⬅ Prev
          </button>
          <button
            onClick={() => go(1)}
            disabled={idx === questions.length - 1}
            className={btnSecondary}
          >
            Next ➡
          </button>
          <button
            onClick={toggleFlag}
            className={`inline-flex items-center gap-1 rounded-lg border px-4 py-2 text-sm font-semibold shadow-sm ${
              flagged.has(idx)
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {flagged.has(idx) ? "🚩 Flagged" : "⚐ Flag"}
          </button>
          <span className="grow" />
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Submit the exam now? You've answered ${answeredCount} of ${questions.length}.`,
                )
              )
                finish();
            }}
            className={btnPrimary}
          >
            Submit exam
          </button>
        </div>
      </div>

      {/* question navigator */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-2 text-xs font-medium text-slate-500">Navigator</div>
        <div className="grid grid-cols-10 gap-1.5 sm:grid-cols-[repeat(15,minmax(0,1fr))]">
          {questions.map((_, i) => {
            const isCur = i === idx;
            const isAns = answers[i] != null;
            const isFlag = flagged.has(i);
            return (
              <button
                key={i}
                onClick={() => setIdx(i)}
                className={`relative h-8 rounded text-xs font-semibold ${
                  isCur
                    ? "ring-2 ring-indigo-500"
                    : ""
                } ${
                  isAns
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {i + 1}
                {isFlag && (
                  <span className="absolute -right-0.5 -top-1 text-[10px]">🚩</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BreakdownTable({
  breakdown,
}: {
  breakdown: Record<string, [number, number]>;
}) {
  const rows = TOPICS.filter((t) => breakdown[t.code]).map((t) => ({
    code: t.code,
    c: breakdown[t.code][0],
    n: breakdown[t.code][1],
  }));
  return (
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
          {rows.map((r) => (
            <tr key={r.code}>
              <td className="px-4 py-2 font-medium text-slate-700">
                {r.code} — {CODE_TO_NAME[r.code]}
              </td>
              <td className="px-4 py-2 text-slate-600">{r.c}</td>
              <td className="px-4 py-2 text-slate-600">{r.n}</td>
              <td className="px-4 py-2 text-slate-600">
                {Math.round((r.c / r.n) * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ history }: { history: ExamAttempt[] | null }) {
  if (!history || history.length === 0) return null;
  const best = Math.max(...history.map((h) => h.correct / Math.max(1, h.total)));
  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">
        📈 Past attempts ({history.length})
      </h3>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Score</th>
              <th className="px-4 py-2 font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.map((h) => {
              const pct = h.total ? Math.round((h.correct / h.total) * 100) : 0;
              const isBest = h.correct / Math.max(1, h.total) === best;
              return (
                <tr key={h.id}>
                  <td className="px-4 py-2 text-slate-600">
                    {h.finished_at ? h.finished_at.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {h.correct}/{h.total} ({pct}%)
                    {isBest && (
                      <span className="ml-1 text-xs text-emerald-600">★ best</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{fmt(h.duration_sec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
