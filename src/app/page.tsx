"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getToday, saveSettings } from "@/app/actions";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { compounding, type HabitSettings } from "@/lib/habits";
import type { TodayData } from "@/lib/types";

export default function TodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [editing, setEditing] = useState(false);

  const load = () => getToday().then(setData).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  if (!data) return <Skeleton />;

  const s = data.settings;
  const cardsMet = data.cardsReviewedToday >= s.goalCards;
  const questionsMet = data.questionsAnsweredToday >= s.goalQuestions;
  const dayComplete = cardsMet && questionsMet;
  const emptyBank = data.dueRemaining === 0 && data.questionsAvailable === 0;
  const niceDate = new Date(data.today + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">🗓️ Today</h1>
          <p className="text-sm text-slate-500">{niceDate}</p>
        </div>
        <button onClick={() => setEditing((v) => !v)} className={btnSecondary}>
          {editing ? "Close" : "⚙️ Customize"}
        </button>
      </div>

      {editing && (
        <CustomizePanel
          settings={s}
          onSaved={async () => {
            await load();
            setEditing(false);
          }}
        />
      )}

      {/* Identity — "every action is a vote for the person you want to become" */}
      <section className="mb-5 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5">
        <Law>Identity</Law>
        <p className="mt-1 text-lg font-semibold text-slate-900">“{s.identity}”</p>
        <p className="mt-1 text-xs text-slate-500">
          Every card you review is a vote for this identity. Show up and cast your vote.
        </p>
      </section>

      {/* Never miss twice */}
      {data.missedYesterday && !data.studiedToday && (
        <section className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <Law tone="amber">Never miss twice</Law>
          <p className="mt-1 text-sm text-amber-900">
            You didn’t study yesterday — that’s okay. Missing once is an accident; missing
            twice is the start of a new (bad) habit. A 2-minute session right now keeps you on
            track.
          </p>
        </section>
      )}

      {/* Today's session — goals + start */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <Law>Make it satisfying · your daily system</Law>
          {dayComplete && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
              ✅ Goal complete
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-6">
          <Ring
            value={data.cardsReviewedToday}
            goal={s.goalCards}
            label="Cards"
            color="#4f46e5"
          />
          <Ring
            value={data.questionsAnsweredToday}
            goal={s.goalQuestions}
            label="Questions"
            color="#0d9488"
          />
          <div className="min-w-[12rem] flex-1">
            {dayComplete ? (
              <p className="text-sm text-slate-700">
                🎉 You hit today’s goal and secured your streak. Anything extra is a bonus —
                but feel free to stop guilt-free. Consistency beats intensity.
              </p>
            ) : (
              <p className="text-sm text-slate-700">
                {data.dueRemaining > 0
                  ? `You have ${data.dueRemaining} card${data.dueRemaining === 1 ? "" : "s"} due. `
                  : "No cards due right now. "}
                <span className="text-slate-500">
                  Make it easy: you don’t have to finish — just <strong>start</strong>.
                </span>
              </p>
            )}
          </div>
        </div>

        {emptyBank ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Your bank is empty. Add content in{" "}
            <Link href="/manage" className="font-semibold text-indigo-700 underline">
              Manage
            </Link>{" "}
            (or load the sample set) to start the habit.
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/flashcards" className={btnPrimary}>
              {data.dueRemaining > 0 ? `Start review · ${data.dueRemaining} due` : "Review cards"}
            </Link>
            <Link href="/quiz" className={btnSecondary}>
              Take a quiz
            </Link>
            {!dayComplete && (
              <span className="self-center text-xs text-slate-400">
                2-minute rule: just 5 cards counts.
              </span>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Streak + don't break the chain */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Law>Don’t break the chain</Law>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-slate-900">{data.streak}</span>
            <span className="text-sm text-slate-500">day streak 🔥</span>
            <span className="ml-auto text-xs text-slate-400">
              {data.totalStudyDays} total days
            </span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <Heatmap weeks={data.heatmap} />
          </div>
        </section>

        {/* 1% better + exam system */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Law>1% better every day</Law>
          <OnePercent streak={data.streak} />
          {data.examDaysLeft !== null && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <Law>Systems &gt; goals</Law>
              {data.examDaysLeft >= 0 ? (
                <p className="mt-1 text-sm text-slate-700">
                  <strong>{data.examDaysLeft}</strong> day
                  {data.examDaysLeft === 1 ? "" : "s"} to your exam. Trust the system: at{" "}
                  {s.goalCards} cards/day that’s ~
                  <strong>{(data.examDaysLeft * s.goalCards).toLocaleString()}</strong> more
                  reviews before exam day.
                </p>
              ) : (
                <p className="mt-1 text-sm text-slate-700">Your exam date has passed. 🎓</p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Cue — implementation intention / habit stacking */}
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <Law>Make it obvious · your cue</Law>
        {s.cue ? (
          <p className="mt-1 text-slate-800">{s.cue}</p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            Set an implementation intention so studying happens on autopilot. Example:{" "}
            <em>“After my morning coffee, I will review CFA cards at 8:00 at my desk.”</em>{" "}
            <button
              onClick={() => setEditing(true)}
              className="font-semibold text-indigo-700 underline"
            >
              Set your cue
            </button>
          </p>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- pieces
function Law({
  children,
  tone = "indigo",
}: {
  children: React.ReactNode;
  tone?: "indigo" | "amber";
}) {
  return (
    <span
      className={`text-[11px] font-bold uppercase tracking-wide ${
        tone === "amber" ? "text-amber-600" : "text-indigo-500"
      }`}
    >
      {children}
    </span>
  );
}

function Ring({
  value,
  goal,
  label,
  color,
}: {
  value: number;
  goal: number;
  label: string;
  color: string;
}) {
  const pct = goal <= 0 ? 1 : Math.min(1, value / goal);
  const r = 30;
  const c = 2 * Math.PI * r;
  const done = pct >= 1;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-20 w-20">
        <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="8" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={done ? "#10b981" : color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-sm font-bold text-slate-900">
            {value}
            <span className="text-slate-400">/{goal}</span>
          </div>
        </div>
      </div>
      <div className="mt-1 text-xs font-medium text-slate-500">
        {done ? "✓ " : ""}
        {label}
      </div>
    </div>
  );
}

function OnePercent({ streak }: { streak: number }) {
  const { gainPct } = compounding(streak);
  const year = compounding(365).multiplier; // ~37.8
  return (
    <>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-bold text-emerald-600">+{gainPct.toFixed(0)}%</span>
        <span className="text-sm text-slate-500">compounded over your streak</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Habits are the compound interest of self-improvement. 1% better every day for a year ={" "}
        <strong>{year.toFixed(0)}×</strong> better. Tiny reviews add up — keep the streak alive.
      </p>
    </>
  );
}

const HEAT = ["bg-slate-100", "bg-indigo-200", "bg-indigo-400", "bg-indigo-600"];
function heatClass(count: number, inFuture: boolean): string {
  if (inFuture) return "bg-transparent";
  if (count === 0) return HEAT[0];
  if (count <= 2) return HEAT[1];
  if (count <= 5) return HEAT[2];
  return HEAT[3];
}

function Heatmap({ weeks }: { weeks: TodayData["heatmap"] }) {
  return (
    <div className="flex gap-1">
      {weeks.map((col, i) => (
        <div key={i} className="flex flex-col gap-1">
          {col.map((cell) => (
            <div
              key={cell.date}
              title={cell.inFuture ? cell.date : `${cell.date}: ${cell.count} actions`}
              className={`h-3 w-3 rounded-sm ${heatClass(cell.count, cell.inFuture)}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CustomizePanel({
  settings,
  onSaved,
}: {
  settings: HabitSettings;
  onSaved: () => void;
}) {
  const [identity, setIdentity] = useState(settings.identity);
  const [cue, setCue] = useState(settings.cue);
  const [goalCards, setGoalCards] = useState(settings.goalCards);
  const [goalQuestions, setGoalQuestions] = useState(settings.goalQuestions);
  const [examDate, setExamDate] = useState(settings.examDate);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await saveSettings({ identity, cue, goalCards, goalQuestions, examDate });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mb-5 space-y-4 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">Customize your system</h2>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Identity statement (Atomic Habits: be the type of person who…)
        </label>
        <input
          value={identity}
          onChange={(e) => setIdentity(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">
          Your cue — implementation intention / habit stack
        </label>
        <input
          value={cue}
          onChange={(e) => setCue(e.target.value)}
          placeholder="After ___, I will review CFA cards at ___."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Daily cards goal</label>
          <input
            type="number"
            min={1}
            max={500}
            value={goalCards}
            onChange={(e) => setGoalCards(Math.max(1, Number(e.target.value) || 1))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Daily questions goal</label>
          <input
            type="number"
            min={0}
            max={500}
            value={goalQuestions}
            onChange={(e) => setGoalQuestions(Math.max(0, Number(e.target.value) || 0))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Exam date (optional)</label>
          <input
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
      <button onClick={save} disabled={busy} className={btnPrimary}>
        {busy ? "Saving…" : "Save system"}
      </button>
    </section>
  );
}

function Skeleton() {
  return (
    <>
      <div className="mb-6 h-8 w-40 animate-pulse rounded bg-slate-200" />
      <div className="mb-5 h-24 animate-pulse rounded-2xl bg-slate-200" />
      <div className="mb-5 h-40 animate-pulse rounded-2xl bg-slate-200" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />
      </div>
    </>
  );
}
