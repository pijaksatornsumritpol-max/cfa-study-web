"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getDashboard } from "@/app/actions";
import { PageTitle } from "@/components/ui";
import type { DashboardData, TopicStat } from "@/lib/types";

function mastery(s: TopicStat): number {
  const cardMastery = s.cards ? s.mature / s.cards : 0;
  const quizAcc = s.attempts ? s.correct / s.attempts : 0;
  if (s.attempts >= 5 && s.cards > 0) return 0.5 * cardMastery + 0.5 * quizAcc;
  if (s.attempts >= 5) return quizAcc;
  return cardMastery;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    getDashboard().then(setData).catch(() => {});
  }, []);

  if (!data) return <Skeleton />;

  const { totals, streak, stats, recent } = data;
  const acc = totals.attempts
    ? `${Math.round((totals.correct / totals.attempts) * 100)}%`
    : "—";
  const empty = totals.cards === 0 && totals.questions === 0;

  return (
    <>
      <PageTitle>📊 Dashboard</PageTitle>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Cards due today" value={totals.due} highlight />
        <Metric label="Total cards" value={totals.cards} />
        <Metric label="Questions in bank" value={totals.questions} />
        <Metric label="Quiz accuracy" value={acc} sub={`${totals.correct}/${totals.attempts}`} />
        <Metric label="Study streak" value={`${streak}d`} icon="🔥" />
      </div>

      {empty ? (
        <div className="mt-8 rounded-xl border border-indigo-100 bg-indigo-50 p-6 text-sm text-slate-700">
          Your bank is empty. Head to{" "}
          <Link href="/manage" className="font-semibold text-indigo-700 underline">
            Manage
          </Link>{" "}
          to import your book/exercise content via CSV — or load the sample set with one click.
        </div>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">
              Coverage &amp; mastery by topic
            </h2>
            <p className="mb-3 text-sm text-slate-500">
              Target = official 2026 CFA L1 exam weight. Mastery blends mature cards
              (interval ≥ 21d) and quiz accuracy. Prioritise high-weight topics with
              low mastery — those rows are flagged.
            </p>
            <TopicTable stats={stats} />
          </section>

          <section className="mt-8">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">
              Recent quiz attempts
            </h2>
            {recent.length === 0 ? (
              <p className="text-sm text-slate-500">
                No attempts yet — try the Quiz tab.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">When</th>
                      <th className="px-4 py-2 font-medium">Topic</th>
                      <th className="px-4 py-2 font-medium">Result</th>
                      <th className="px-4 py-2 font-medium">Question</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recent.map((r, i) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                          {r.answered_at.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-4 py-2 font-medium">{r.topic_code}</td>
                        <td className="px-4 py-2">{r.is_correct ? "✅" : "❌"}</td>
                        <td className="px-4 py-2 text-slate-700">
                          {r.stem.length > 80 ? r.stem.slice(0, 80) + "…" : r.stem}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function TopicTable({ stats }: { stats: TopicStat[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Topic</th>
            <th className="px-4 py-2 font-medium">Target</th>
            <th className="px-4 py-2 font-medium">Cards</th>
            <th className="px-4 py-2 font-medium">Due</th>
            <th className="px-4 py-2 font-medium">Qs</th>
            <th className="px-4 py-2 font-medium">Quiz acc.</th>
            <th className="w-48 px-4 py-2 font-medium">Mastery</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {stats.map((s) => {
            const target = (s.weight_low + s.weight_high) / 2;
            const m = Math.round(mastery(s) * 100);
            const quizAcc = s.attempts
              ? `${Math.round((s.correct / s.attempts) * 100)}%`
              : "—";
            // Flag high-weight, low-mastery topics as priorities.
            const priority = target >= 10 && m < 50;
            return (
              <tr key={s.code} className={priority ? "bg-amber-50" : ""}>
                <td className="px-4 py-2">
                  <span
                    className={`mr-2 inline-block h-2 w-2 rounded-full ${
                      priority ? "bg-amber-500" : "bg-transparent"
                    }`}
                  />
                  <span className="font-medium text-slate-800">{s.code}</span>
                  <span className="ml-1 hidden text-slate-500 sm:inline">
                    — {s.name}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-600">{target.toFixed(1)}%</td>
                <td className="px-4 py-2 text-slate-600">{s.cards}</td>
                <td className="px-4 py-2 text-slate-600">{s.due}</td>
                <td className="px-4 py-2 text-slate-600">{s.questions}</td>
                <td className="px-4 py-2 text-slate-600">{quizAcc}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${
                          m >= 70 ? "bg-emerald-500" : m >= 40 ? "bg-indigo-500" : "bg-rose-400"
                        }`}
                        style={{ width: `${m}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-xs tabular-nums text-slate-500">
                      {m}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  icon,
  highlight,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 ${
        highlight ? "border-indigo-200 ring-1 ring-indigo-100" : "border-slate-200"
      }`}
    >
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">
        {value} {icon && <span>{icon}</span>}
      </div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <PageTitle>📊 Dashboard</PageTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
        ))}
      </div>
      <div className="mt-8 h-64 animate-pulse rounded-xl bg-slate-200" />
    </>
  );
}
