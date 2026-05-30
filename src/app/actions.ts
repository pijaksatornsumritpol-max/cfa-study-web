"use server";

// Server Functions = the backend. These run only on the server (DB access) and
// are called directly from client components as async functions.
import Papa from "papaparse";
import {
  activityDates,
  addDaysISO,
  addFlashcard,
  addQuestion,
  allCards,
  bulkAddFlashcards,
  bulkAddQuestions,
  countsByTopic,
  deleteFlashcard,
  deleteQuestion,
  dueFlashcards,
  ensureInit,
  getFlashcardState,
  getQuestions,
  recentAttempts,
  recordAttempt,
  todayISO,
  updateCardSchedule,
} from "@/lib/db";
import { schedule } from "@/lib/srs";
import { SAMPLE_CARDS, SAMPLE_QUESTIONS } from "@/lib/seed-data";
import { TOPIC_CODES } from "@/lib/topics";
import type {
  DashboardData,
  Flashcard,
  ImportResult,
  Question,
} from "@/lib/types";

// ---------------------------------------------------------------- dashboard
function computeStreak(days: Set<string>): number {
  if (days.size === 0) return 0;
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);
  if (!days.has(today) && !days.has(yesterday)) return 0;
  let d = days.has(today) ? today : yesterday;
  let streak = 0;
  while (days.has(d)) {
    streak += 1;
    d = addDaysISO(d, -1);
  }
  return streak;
}

export async function getDashboard(): Promise<DashboardData> {
  await ensureInit();
  const stats = await countsByTopic();
  const totals = stats.reduce(
    (acc, s) => ({
      cards: acc.cards + s.cards,
      due: acc.due + s.due,
      questions: acc.questions + s.questions,
      attempts: acc.attempts + s.attempts,
      correct: acc.correct + s.correct,
    }),
    { cards: 0, due: 0, questions: 0, attempts: 0, correct: 0 },
  );
  const streak = computeStreak(await activityDates());
  const recent = await recentAttempts(15);
  return { totals, streak, stats, recent };
}

export async function getSidebarCounts(): Promise<{ due: number; questions: number }> {
  await ensureInit();
  const stats = await countsByTopic();
  return {
    due: stats.reduce((a, s) => a + s.due, 0),
    questions: stats.reduce((a, s) => a + s.questions, 0),
  };
}

// ---------------------------------------------------------------- flashcards
export async function getDueCards(code?: string | null): Promise<Flashcard[]> {
  await ensureInit();
  return dueFlashcards(code ?? null);
}

export async function reviewCard(cardId: number, quality: number): Promise<void> {
  await ensureInit();
  const state = await getFlashcardState(cardId);
  if (!state) return;
  const { ease, interval, reps } = schedule(
    state.ease,
    state.interval,
    state.reps,
    quality,
  );
  const due = addDaysISO(todayISO(), interval);
  await updateCardSchedule(cardId, ease, interval, reps, due, quality);
}

// ---------------------------------------------------------------- quiz
export async function getQuiz(
  code: string | null,
  n: number,
): Promise<Question[]> {
  await ensureInit();
  return getQuestions(code ?? null, n, true);
}

export async function submitAnswer(
  questionId: number,
  topicId: number,
  chosen: string,
  isCorrect: boolean,
): Promise<void> {
  await ensureInit();
  await recordAttempt(questionId, topicId, chosen, isCorrect);
}

// ---------------------------------------------------------------- manage: add
export async function addCard(
  code: string,
  front: string,
  back: string,
  tags: string,
): Promise<{ ok: boolean }> {
  await ensureInit();
  if (!front.trim() || !back.trim() || !TOPIC_CODES.includes(code))
    return { ok: false };
  const ok = await addFlashcard(code, front.trim(), back.trim(), tags.trim());
  return { ok };
}

export async function addQuiz(
  code: string,
  stem: string,
  a: string,
  b: string,
  c: string,
  correct: string,
  explanation: string,
): Promise<{ ok: boolean }> {
  await ensureInit();
  if (
    !TOPIC_CODES.includes(code) ||
    ![stem, a, b, c].every((x) => x.trim()) ||
    !["A", "B", "C"].includes(correct)
  )
    return { ok: false };
  const ok = await addQuestion(
    code,
    stem.trim(),
    a.trim(),
    b.trim(),
    c.trim(),
    correct,
    explanation.trim(),
  );
  return { ok };
}

// ---------------------------------------------------------------- manage: import
export async function importCardsCsv(text: string): Promise<ImportResult> {
  await ensureInit();
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.toLowerCase().trim(),
  });
  const fields = res.meta.fields ?? [];
  if (!["topic_code", "front", "back"].every((f) => fields.includes(f)))
    return {
      added: 0,
      skipped: 0,
      error: "CSV must have columns: topic_code, front, back (tags optional)",
    };

  const valid: { code: string; front: string; back: string; tags: string }[] = [];
  let skipped = 0;
  for (const row of res.data) {
    const code = (row.topic_code ?? "").trim().toUpperCase();
    const front = (row.front ?? "").trim();
    const back = (row.back ?? "").trim();
    const tags = (row.tags ?? "").trim();
    if (TOPIC_CODES.includes(code) && front && back)
      valid.push({ code, front, back, tags });
    else skipped += 1;
  }
  const added = await bulkAddFlashcards(valid);
  return { added, skipped: skipped + (valid.length - added) };
}

export async function importQuestionsCsv(text: string): Promise<ImportResult> {
  await ensureInit();
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.toLowerCase().trim(),
  });
  const fields = res.meta.fields ?? [];
  const required = ["topic_code", "stem", "choice_a", "choice_b", "choice_c", "correct"];
  if (!required.every((f) => fields.includes(f)))
    return {
      added: 0,
      skipped: 0,
      error:
        "CSV must have columns: topic_code, stem, choice_a, choice_b, choice_c, correct (explanation optional)",
    };

  const valid: {
    code: string;
    stem: string;
    a: string;
    b: string;
    c: string;
    correct: string;
    explanation: string;
  }[] = [];
  let skipped = 0;
  for (const row of res.data) {
    const code = (row.topic_code ?? "").trim().toUpperCase();
    const stem = (row.stem ?? "").trim();
    const a = (row.choice_a ?? "").trim();
    const b = (row.choice_b ?? "").trim();
    const c = (row.choice_c ?? "").trim();
    const correct = (row.correct ?? "").trim().toUpperCase();
    const explanation = (row.explanation ?? "").trim();
    if (
      TOPIC_CODES.includes(code) &&
      stem &&
      a &&
      b &&
      c &&
      ["A", "B", "C"].includes(correct)
    )
      valid.push({ code, stem, a, b, c, correct, explanation });
    else skipped += 1;
  }
  const added = await bulkAddQuestions(valid);
  return { added, skipped: skipped + (valid.length - added) };
}

// ---------------------------------------------------------------- manage: browse
export async function browseCards(code?: string | null): Promise<Flashcard[]> {
  await ensureInit();
  return allCards(code ?? null);
}

export async function browseQuestions(code?: string | null): Promise<Question[]> {
  await ensureInit();
  return getQuestions(code ?? null, undefined, false);
}

// ---------------------------------------------------------------- manage: seed
export async function seedSamples(): Promise<ImportResult> {
  await ensureInit();
  const stats = await countsByTopic();
  const hasContent = stats.some((s) => s.cards > 0 || s.questions > 0);
  if (hasContent)
    return { added: 0, skipped: 0, error: "Bank isn't empty — sample set only loads into an empty bank." };

  const cards = await bulkAddFlashcards(
    SAMPLE_CARDS.map(([code, front, back, tags]) => ({ code, front, back, tags })),
  );
  const questions = await bulkAddQuestions(
    SAMPLE_QUESTIONS.map(([code, stem, a, b, c, correct, explanation]) => ({
      code,
      stem,
      a,
      b,
      c,
      correct,
      explanation,
    })),
  );
  return { added: cards + questions, skipped: 0 };
}

export async function removeCard(id: number): Promise<void> {
  await ensureInit();
  await deleteFlashcard(id);
}

export async function removeQuestion(id: number): Promise<void> {
  await ensureInit();
  await deleteQuestion(id);
}
