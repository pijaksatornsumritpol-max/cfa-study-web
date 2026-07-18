"use client";

import { useCallback, useEffect, useState } from "react";
import { getDueCards, getFlashcardDifficultyCounts, getFlashcardsByDifficulty, reviewCard } from "@/app/actions";
import { btnSecondary, PageTitle, TopicSelect } from "@/components/ui";
import { TutorSidebar } from "@/components/TutorSidebar";
import { celebrate } from "@/lib/confetti";
import { intervalPreview, QUALITY, type Rating } from "@/lib/srs";
import { CODE_TO_NAME, TOPIC_CODES } from "@/lib/topics";
import type { Flashcard } from "@/lib/types";

const BUTTONS: { rating: Rating; label: string; cls: string }[] = [
  { rating: "Again", label: "❌ Again", cls: "bg-rose-500 hover:bg-rose-600" },
  { rating: "Hard", label: "😬 Hard", cls: "bg-amber-500 hover:bg-amber-600" },
  { rating: "Good", label: "🙂 Good", cls: "bg-indigo-600 hover:bg-indigo-700" },
  { rating: "Easy", label: "😎 Easy", cls: "bg-emerald-600 hover:bg-emerald-700" },
];

export default function FlashcardsPage() {
  const [topic, setTopic] = useState("ALL");
  const [mode, setMode] = useState<"due" | "hard" | "easy">("due");
  const [counts, setCounts] = useState<{ due: number; hard: number; easy: number } | null>(null);
  const [queue, setQueue] = useState<Flashcard[] | null>(null);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);

  // Deep link: pre-select the topic from a ?topic= query param (e.g. from Notes).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("topic");
    if (t && TOPIC_CODES.includes(t.toUpperCase())) setTopic(t.toUpperCase());
  }, []);

  const refreshCounts = useCallback(() => {
    getFlashcardDifficultyCounts(topic === "ALL" ? null : topic)
      .then(setCounts)
      .catch(() => setCounts(null));
  }, [topic]);

  const load = useCallback(() => {
    setQueue(null);
    setShow(false);
    const c = topic === "ALL" ? null : topic;
    const p = mode === "due" ? getDueCards(c) : getFlashcardsByDifficulty(c, mode);
    p.then(setQueue).catch(() => setQueue([]));
  }, [topic, mode]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    refreshCounts();
  }, [refreshCounts]);

  const card = queue && queue.length > 0 ? queue[0] : null;

  async function rate(rating: Rating) {
    if (!card || busy) return;
    const wasLast = (queue?.length ?? 0) <= 1;
    setBusy(true);
    try {
      await reviewCard(card.id, QUALITY[rating]);
    } finally {
      setBusy(false);
    }
    setQueue((q) => (q ? q.slice(1) : q));
    setShow(false);
    refreshCounts();
    if (wasLast) celebrate(); // cleared the queue 🎉
  }

  return (
    <>
      <PageTitle>🃏 Flashcards — Spaced Repetition</PageTitle>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Filter by topic
          </label>
          <TopicSelect value={topic} onChange={setTopic} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Review pool
          </label>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(
              [
                ["due", "Due", counts?.due],
                ["hard", "😬 Hard", counts?.hard],
                ["easy", "😎 Easy", counts?.easy],
              ] as const
            ).map(([m, label, n]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-white text-indigo-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
                {n !== undefined ? ` (${n})` : ""}
              </button>
            ))}
          </div>
        </div>
        <button onClick={load} className={btnSecondary}>
          🔄 Rebuild queue
        </button>
      </div>

      {queue === null ? (
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
      ) : !card ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-6 text-sm text-slate-700">
          {mode === "due"
            ? "🎉 No cards due right now for this filter. Come back later, or add more in Manage."
            : mode === "hard"
              ? "No cards rated Hard/Again yet. Review some cards and tap 😬 Hard or ❌ Again — they'll show up here so you can drill just the tough ones."
              : "No cards rated Good/Easy yet. Rate some cards 🙂 Good or 😎 Easy and they'll appear here."}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
              {queue.length} {mode === "due" ? "due" : mode}
            </span>
            <span>
              {card.topic_code} — {CODE_TO_NAME[card.topic_code]}
            </span>
            <span>reps {card.reps}</span>
            <span>ease {card.ease.toFixed(2)}</span>
          </div>

          <div className="text-lg font-medium text-slate-900">{card.front}</div>
          {card.tags && (
            <div className="mt-2 text-xs text-slate-400">🏷 {card.tags}</div>
          )}
          <button
            onClick={() => setTutorOpen(true)}
            className="mt-4 inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            🤖 Ask about this card
          </button>

          {!show ? (
            <button
              onClick={() => setShow(true)}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
            >
              Show answer
            </button>
          ) : (
            <>
              <hr className="my-5 border-slate-200" />
              <div className="whitespace-pre-wrap text-slate-700">{card.back}</div>
              <hr className="my-5 border-slate-200" />
              <RatingButtons card={card} busy={busy} onRate={rate} />
            </>
          )}
        </div>
      )}

      {tutorOpen && card && <TutorSidebar card={card} onClose={() => setTutorOpen(false)} />}
    </>
  );
}

function RatingButtons({
  card,
  busy,
  onRate,
}: {
  card: Flashcard;
  busy: boolean;
  onRate: (r: Rating) => void;
}) {
  const preview = intervalPreview(card.ease, card.interval, card.reps);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {BUTTONS.map((b) => (
        <button
          key={b.rating}
          disabled={busy}
          onClick={() => onRate(b.rating)}
          className={`flex flex-col items-center rounded-lg px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-50 ${b.cls}`}
        >
          <span>{b.label}</span>
          <span className="text-xs font-normal opacity-90">
            {preview[b.rating]}d
          </span>
        </button>
      ))}
    </div>
  );
}
