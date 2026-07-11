"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  getPushConfig,
  getStudyPlan,
  removePushSub,
  savePushSub,
  saveSettings,
  sendTestPush,
} from "@/app/actions";
import { btnPrimary, btnSecondary, PageTitle } from "@/components/ui";
import type { StudyPlan, TopicPlan, WeekBlock } from "@/lib/plan";

const DEFAULT_EXAM = "2027-02-16";

interface PlanData {
  plan: StudyPlan;
  streak: number;
  reward: string;
  examDate: string;
}

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export default function PlanPage() {
  const [data, setData] = useState<PlanData | null>(null);
  const [examInput, setExamInput] = useState(DEFAULT_EXAM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getStudyPlan()
      .then((d) => {
        setData(d);
        if (d.examDate) setExamInput(d.examDate);
      })
      .catch(() => setData(null));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function saveExam() {
    setSaving(true);
    try {
      await saveSettings({ examDate: examInput });
      load();
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return (
      <>
        <PageTitle>🎯 Study Plan</PageTitle>
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
      </>
    );
  }

  const { plan, streak, reward } = data;
  const hasExam = plan.pace !== "no-exam";

  return (
    <>
      <PageTitle>🎯 Dynamic Study Plan</PageTitle>

      {/* Exam date + countdown */}
      <div className="mb-5 flex flex-wrap items-end gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            CFA Level 1 exam date
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={examInput}
              onChange={(e) => setExamInput(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button onClick={saveExam} disabled={saving} className={btnSecondary}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {hasExam && (
          <>
            <Stat big label="Days left" value={plan.daysLeft} accent="indigo" />
            <Stat label="Weeks left" value={plan.weeksLeft} />
            <Stat
              label="Overall readiness"
              value={`${plan.overallReadiness}%`}
              accent={plan.overallReadiness >= 60 ? "emerald" : "amber"}
            />
          </>
        )}
      </div>

      {!hasExam ? (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-6 text-sm text-slate-700">
          Set your exam date above to generate a paced, weighted study schedule.
        </div>
      ) : (
        <>
          {/* Pace banner */}
          <div
            className={`mb-5 rounded-2xl border p-4 text-sm ${
              plan.pace === "behind"
                ? "border-rose-200 bg-rose-50 text-rose-800"
                : plan.pace === "ahead"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-indigo-100 bg-indigo-50 text-indigo-900"
            }`}
          >
            <span className="font-semibold">
              {plan.pace === "behind"
                ? "⚡ Accelerate"
                : plan.pace === "ahead"
                  ? "🚀 Ahead of pace"
                  : "✅ On track"}
            </span>{" "}
            — {plan.paceMsg}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Start now */}
            {plan.startNow && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
                  Start here now
                </div>
                <div className="mt-1 text-xl font-bold text-slate-900">
                  {plan.startNow.name}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  Exam weight ~{Math.round(plan.startNow.weight)}% ·{" "}
                  {plan.startNow.status === "not-started"
                    ? "not started yet"
                    : `${plan.startNow.readiness}% ready`}{" "}
                  · highest priority right now
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href={`/notes`} className={btnSecondary}>
                    📖 Read notes
                  </Link>
                  <Link href={`/flashcards?topic=${plan.startNow.code}`} className={btnSecondary}>
                    🃏 Flashcards
                  </Link>
                  <Link href={`/quiz?topic=${plan.startNow.code}`} className={btnPrimary}>
                    📝 Quiz {plan.startNow.code}
                  </Link>
                </div>
              </div>
            )}

            {/* This week */}
            {plan.thisWeek && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-indigo-500">
                  This week ({fmtDate(plan.thisWeek.startISO)} –{" "}
                  {fmtDate(plan.thisWeek.endISO)})
                </div>
                <div className="mt-1 font-semibold text-slate-900">
                  {plan.thisWeek.label}
                </div>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
                  <li>📖 Read this topic&apos;s summary notes</li>
                  <li>🃏 Clear today&apos;s flashcard queue</li>
                  <li>📝 Do 15–20 questions, then review your mistakes</li>
                </ul>
              </div>
            )}
          </div>

          {/* Schedule */}
          <h3 className="mb-2 mt-7 text-sm font-semibold text-slate-700">
            📅 Weekly schedule ({plan.totalWeeks} weeks → exam)
          </h3>
          <Schedule schedule={plan.schedule} />

          {/* Per-topic readiness */}
          <h3 className="mb-2 mt-7 text-sm font-semibold text-slate-700">
            Topic readiness & priority
          </h3>
          <TopicTable topics={plan.topics} />

          {/* Reward + streak */}
          <RewardPanel streak={streak} reward={reward} />

          {/* Daily push reminders */}
          <NotificationsPanel />
        </>
      )}
    </>
  );
}

// Convert a base64url VAPID public key to the Uint8Array the Push API expects.
// Backed by a concrete ArrayBuffer so it satisfies BufferSource under strict TS.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function NotificationsPanel() {
  const [cfg, setCfg] = useState<{
    configured: boolean;
    publicKey: string;
    subscribers: number;
  } | null>(null);
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [isIOS, setIsIOS] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getPushConfig().then(setCfg).catch(() => setCfg(null));
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (!ok) {
      // iOS only exposes the Push API once the PWA is installed to the home screen.
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const sa =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsIOS(ios);
      setStandalone(sa);
      return;
    }
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true,
    );
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        setSubscribed(!!sub);
      }
    });
  }, []);

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      if (!cfg?.publicKey) {
        setMsg("⚠ Server notification keys aren't set yet.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMsg("Notifications were blocked. Allow them in your browser settings to turn this on.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
      });
      const json = sub.toJSON();
      const r = await savePushSub({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      if (!r.ok) {
        setMsg("⚠ Couldn't save the subscription — try again.");
        return;
      }
      setSubscribed(true);
      setMsg("✅ Daily reminders are on. You'll get a study nudge each morning (~8am).");
    } catch (e) {
      setMsg("Couldn't enable notifications: " + String(e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await removePushSub(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg("Reminders turned off on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg("");
    try {
      const r = await sendTestPush();
      setMsg(
        r.ok
          ? `📨 Sent a test reminder to ${r.sent}/${r.total} device(s). Check your notifications.`
          : `⚠ ${r.error}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-800">🔔 Daily reminders</div>

      {cfg === null ? (
        <div className="mt-2 h-6 w-40 animate-pulse rounded bg-slate-200" />
      ) : !cfg.configured ? (
        <div className="mt-2 text-sm text-slate-600">
          <p>
            Push reminders need server keys. Set{" "}
            <code className="rounded bg-slate-100 px-1 text-xs">VAPID_PUBLIC_KEY</code> and{" "}
            <code className="rounded bg-slate-100 px-1 text-xs">VAPID_PRIVATE_KEY</code> in your
            Vercel env vars, then redeploy.
          </p>
        </div>
      ) : !supported ? (
        <div className="mt-2 text-sm text-slate-600">
          {isIOS && !standalone ? (
            <p>
              On iPhone, first install the app: tap{" "}
              <span className="font-medium">Share → Add to Home Screen</span>, then open it from
              the CFA icon and turn reminders on here.
            </p>
          ) : (
            <p>This browser doesn&apos;t support push notifications.</p>
          )}
        </div>
      ) : (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-slate-600">
            Get a morning nudge with your days-left, today&apos;s focus topic, and your streak —
            so you never miss a study day.
          </p>
          {subscribed ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={test} disabled={busy} className={btnSecondary}>
                {busy ? "…" : "📨 Send a test"}
              </button>
              <button onClick={disable} disabled={busy} className={btnSecondary}>
                Turn off
              </button>
            </div>
          ) : (
            <button onClick={enable} disabled={busy} className={btnPrimary}>
              {busy ? "Enabling…" : "🔔 Turn on daily reminders"}
            </button>
          )}
          {isIOS && (
            <p className="text-xs text-slate-400">
              iPhone: reminders only work after you&apos;ve added the app to your Home Screen.
            </p>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  big,
  accent = "slate",
}: {
  label: string;
  value: string | number;
  big?: boolean;
  accent?: "slate" | "indigo" | "emerald" | "amber";
}) {
  const color =
    accent === "indigo"
      ? "text-indigo-600"
      : accent === "emerald"
        ? "text-emerald-600"
        : accent === "amber"
          ? "text-amber-600"
          : "text-slate-800";
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`font-bold ${big ? "text-3xl" : "text-2xl"} ${color}`}>{value}</div>
    </div>
  );
}

function Schedule({ schedule }: { schedule: WeekBlock[] }) {
  const learn = schedule.filter((b) => b.kind === "learn");
  const review = schedule.filter((b) => b.kind === "review");
  return (
    <div className="space-y-2">
      {learn.map((b, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <span className="inline-flex shrink-0 items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
            Wk {b.index}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800">{b.label}</div>
            <div className="text-xs text-slate-400">
              {fmtDate(b.startISO)} – {fmtDate(b.endISO)}
            </div>
          </div>
        </div>
      ))}
      {review.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
          <span className="inline-flex shrink-0 items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            Final {review.length} wk
          </span>
          <div>
            <div className="text-sm font-medium text-slate-800">
              Review weak topics + full timed Mock Exams (Simulation), then clear your
              mistakes
            </div>
            <div className="text-xs text-slate-500">
              {fmtDate(review[0].startISO)} – {fmtDate(review[review.length - 1].endISO)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TopicTable({ topics }: { topics: TopicPlan[] }) {
  const badge: Record<TopicPlan["status"], string> = {
    "not-started": "bg-slate-100 text-slate-500",
    learning: "bg-amber-50 text-amber-700",
    strong: "bg-emerald-50 text-emerald-700",
  };
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Topic</th>
            <th className="px-4 py-2 font-medium">Weight</th>
            <th className="px-4 py-2 font-medium">Readiness</th>
            <th className="px-4 py-2 font-medium">Plan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {topics.map((t) => (
            <tr key={t.code}>
              <td className="px-4 py-2">
                <span className="font-medium text-slate-700">{t.code}</span>{" "}
                <span className="text-slate-400">— {t.name}</span>
              </td>
              <td className="px-4 py-2 text-slate-600">~{Math.round(t.weight)}%</td>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${t.readiness}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">{t.readiness}%</span>
                  <span className={`rounded px-1.5 py-0.5 text-[11px] ${badge[t.status]}`}>
                    {t.status === "not-started"
                      ? "new"
                      : t.status === "strong"
                        ? "strong"
                        : "learning"}
                  </span>
                </div>
              </td>
              <td className="px-4 py-2 text-slate-500">
                {t.weeks} wk{t.weeks === 1 ? "" : "s"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RewardPanel({ streak, reward }: { streak: number; reward: string }) {
  const milestone = 7;
  const intoMilestone = streak % milestone;
  const toNext = streak > 0 ? milestone - intoMilestone : milestone;
  const unlocked = streak > 0 && intoMilestone === 0;
  return (
    <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-xs font-medium text-amber-700">Current streak</div>
          <div className="text-3xl font-bold text-amber-700">🔥 {streak}d</div>
        </div>
        <div className="min-w-0 grow">
          {reward ? (
            <>
              <div className="text-sm text-slate-700">
                Reward (temptation bundle):{" "}
                <span className="font-semibold text-slate-900">{reward}</span>
              </div>
              <div className="mt-1 text-sm">
                {unlocked ? (
                  <span className="font-semibold text-emerald-700">
                    🎉 {streak}-day streak — you earned your reward! Enjoy it, then keep
                    the chain going.
                  </span>
                ) : (
                  <span className="text-amber-800">
                    {toNext} more day{toNext === 1 ? "" : "s"} of studying to unlock your
                    reward (every {milestone}-day streak).
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-600">
              Set a reward in{" "}
              <Link href="/" className="font-semibold text-indigo-600 underline">
                Today → ⚙️
              </Link>{" "}
              (e.g. &quot;a movie&quot;) to unlock it every {milestone}-day streak.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
