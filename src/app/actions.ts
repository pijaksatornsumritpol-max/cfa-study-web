"use server";

// Server Functions = the backend. These run only on the server (DB access) and
// are called directly from client components as async functions.
import Papa from "papaparse";
import {
  activityCountsForDay,
  activityDates,
  addDaysISO,
  addFlashcard,
  addQuestion,
  allCards,
  bulkAddFlashcards,
  bulkAddQuestions,
  countsByTopic,
  dailyActivity,
  deleteFlashcard,
  deleteQuestion,
  dueFlashcards,
  ensureInit,
  getExplanation,
  getFlashcardState,
  getQuestions,
  getSettingsRaw,
  recentAttempts,
  recordAttempt,
  saveExplanation,
  setSettingsRaw,
  todayISO,
  updateCardSchedule,
} from "@/lib/db";
import { schedule } from "@/lib/srs";
import { buildHeatmap, parseSettings, type HabitSettings } from "@/lib/habits";
import { SAMPLE_CARDS, SAMPLE_QUESTIONS } from "@/lib/seed-data";
import { CODE_TO_NAME, TOPIC_CODES } from "@/lib/topics";
import type {
  DashboardData,
  Flashcard,
  GenCard,
  GenQuestion,
  GenResult,
  ImportResult,
  Question,
  TodayData,
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

// ---------------------------------------------------------------- today / habits
function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00").getTime();
  const b = new Date(toISO + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

export async function getToday(): Promise<TodayData> {
  await ensureInit();
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);

  const settings = parseSettings(await getSettingsRaw());
  const todayCounts = await activityCountsForDay(today);
  const stats = await countsByTopic();
  const days = await activityDates();

  const weeks = 12;
  const activityMap = await dailyActivity(addDaysISO(today, -(weeks * 7)));

  return {
    today,
    settings,
    cardsReviewedToday: todayCounts.cards,
    questionsAnsweredToday: todayCounts.questions,
    dueRemaining: stats.reduce((a, s) => a + s.due, 0),
    questionsAvailable: stats.reduce((a, s) => a + s.questions, 0),
    streak: computeStreak(days),
    studiedToday: days.has(today),
    missedYesterday: !days.has(yesterday),
    totalStudyDays: days.size,
    heatmap: buildHeatmap(today, Object.fromEntries(activityMap), weeks),
    examDaysLeft: settings.examDate ? daysBetween(today, settings.examDate) : null,
  };
}

export async function saveSettings(input: Partial<HabitSettings>): Promise<void> {
  await ensureInit();
  const entries: Record<string, string> = {};
  if (input.identity !== undefined) entries.identity = input.identity.slice(0, 300);
  if (input.cue !== undefined) entries.cue = input.cue.slice(0, 500);
  if (input.reward !== undefined) entries.reward = input.reward.slice(0, 300);
  if (input.examDate !== undefined) entries.examDate = input.examDate.slice(0, 10);
  if (input.goalCards !== undefined)
    entries.goalCards = String(Math.max(1, Math.min(500, Math.trunc(input.goalCards))));
  if (input.goalQuestions !== undefined)
    entries.goalQuestions = String(Math.max(0, Math.min(500, Math.trunc(input.goalQuestions))));
  await setSettingsRaw(entries);
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

// ---------------------------------------------------------------- AI explain
// Stable, frozen system prompt (no per-request data) so prompt caching can work
// once it's long enough to cache. NOTE: Claude Haiku's minimum cacheable prefix
// is 4096 tokens — at this short length the cache_control marker is a no-op
// (it silently won't cache). The real cost-saver is the DB result cache below:
// each question is explained by the API at most once, then served from SQLite.
const EXPLAIN_SYSTEM =
  "You are a CFA Level 1 tutor. In 3-5 sentences of plain English, explain why the correct answer is right and briefly why each other option is wrong. Focus on the underlying CFA concept. Do not restate the question.";

export async function explainQuestion(
  questionId: number,
  stem: string,
  choices: { a: string; b: string; c: string },
  correct: string,
): Promise<{ text?: string; error?: string; cached?: boolean }> {
  await ensureInit();

  // 1. DB result cache — same question is generated once, then reused for free.
  const hit = await getExplanation(questionId);
  if (hit) return { text: hit.text, cached: true };

  // 2. Chosen-agnostic user prompt (so the cache key is just the question).
  const userContent = `Question: ${stem}\nA) ${choices.a}\nB) ${choices.b}\nC) ${choices.c}\nCorrect answer: ${correct}`;

  // 3. Call a provider: Claude (preferred) → Gemini → none configured.
  let result: { text?: string; error?: string };
  let model: string;
  if (process.env.ANTHROPIC_API_KEY) {
    model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
    result = await callClaude(process.env.ANTHROPIC_API_KEY, model, userContent, EXPLAIN_SYSTEM, 500);
  } else if (process.env.GEMINI_API_KEY) {
    model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    result = await callGemini(process.env.GEMINI_API_KEY, model, userContent, EXPLAIN_SYSTEM, 500);
  } else {
    return {
      error:
        "AI explanations aren’t set up yet. Add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) environment variable.",
    };
  }

  // 4. Persist on success so the next request for this question is free.
  if (result.text) {
    await saveExplanation(questionId, result.text, model);
    return { text: result.text, cached: false };
  }
  return { error: result.error };
}

async function callClaude(
  key: string,
  model: string,
  userContent: string,
  system: string,
  maxTokens: number,
): Promise<{ text?: string; error?: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { error: `Claude request failed (${res.status}). ${detail}` };
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) return { error: "Claude returned an empty response — try again." };
    return { text };
  } catch (e) {
    return { error: "Could not reach Claude. " + String(e).slice(0, 150) };
  }
}

async function callGemini(
  key: string,
  model: string,
  userContent: string,
  system: string,
  maxTokens: number,
): Promise<{ text?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: userContent }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: maxTokens },
        }),
      },
    );
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { error: `AI request failed (${res.status}). ${detail}` };
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) return { error: "AI returned an empty response — try again." };
    return { text };
  } catch (e) {
    return { error: "Could not reach the AI service. " + String(e).slice(0, 150) };
  }
}

// ---------------------------------------------------------------- AI generate
function genSystem(topicName: string): string {
  return `You are a CFA Level 1 exam tutor and question writer. From the user's study text, write high-quality, exam-style study material for the topic "${topicName}". Base everything strictly on the provided text — do not invent facts it does not support. Flashcards: a concise front (a question, term, or "what is X?") and a back (the answer, definition, or formula). Multiple-choice questions: a clear stem, exactly three options A/B/C with one correct answer, and a one-sentence explanation. Respond with ONLY a JSON object (no markdown fences, no prose) of the form {"flashcards":[{"front":"","back":"","tags":""}],"questions":[{"stem":"","choice_a":"","choice_b":"","choice_c":"","correct":"A","explanation":""}]}. "correct" must be "A", "B", or "C". "tags" is a short comma-separated string and may be empty.`;
}

export async function generateFromText(
  code: string,
  text: string,
  nCards: number,
  nQuestions: number,
): Promise<GenResult> {
  await ensureInit();
  if (!TOPIC_CODES.includes(code))
    return { flashcards: [], questions: [], error: "Pick a valid topic first." };
  const clean = text.trim().slice(0, 24000); // ~6k-token cap to bound cost/latency
  if (clean.length < 50)
    return { flashcards: [], questions: [], error: "Paste more study text (at least a paragraph)." };
  const nc = Math.max(0, Math.min(20, Math.trunc(nCards)));
  const nq = Math.max(0, Math.min(20, Math.trunc(nQuestions)));
  if (nc + nq === 0)
    return { flashcards: [], questions: [], error: "Ask for at least one card or question." };

  const system = genSystem(CODE_TO_NAME[code] ?? code);
  const user = `Create ${nc} flashcards and ${nq} multiple-choice questions from this study text:\n\n${clean}`;

  let result: { text?: string; error?: string };
  if (process.env.ANTHROPIC_API_KEY) {
    result = await callClaude(
      process.env.ANTHROPIC_API_KEY,
      process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
      user,
      system,
      4096,
    );
  } else if (process.env.GEMINI_API_KEY) {
    result = await callGemini(
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_MODEL || "gemini-2.0-flash",
      user,
      system,
      4096,
    );
  } else {
    return {
      flashcards: [],
      questions: [],
      error: "AI isn’t set up. Add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) environment variable.",
    };
  }
  if (!result.text) return { flashcards: [], questions: [], error: result.error };

  const parsed = parseLooseJson(result.text);
  if (!parsed)
    return { flashcards: [], questions: [], error: "The AI response couldn’t be parsed — try again." };
  const flashcards = sanitizeCards(parsed.flashcards);
  const questions = sanitizeQuestions(parsed.questions);
  if (!flashcards.length && !questions.length)
    return {
      flashcards: [],
      questions: [],
      error: "The AI didn’t return usable items — try again or paste more text.",
    };
  return { flashcards, questions };
}

export async function saveGenerated(
  code: string,
  flashcards: GenCard[],
  questions: GenQuestion[],
): Promise<{ cards: number; questions: number }> {
  await ensureInit();
  if (!TOPIC_CODES.includes(code)) return { cards: 0, questions: 0 };
  const cards = await bulkAddFlashcards(
    flashcards
      .filter((f) => f.front.trim() && f.back.trim())
      .map((f) => ({ code, front: f.front, back: f.back, tags: f.tags })),
  );
  const qs = await bulkAddQuestions(
    questions
      .filter((q) => q.stem.trim() && ["A", "B", "C"].includes(q.correct))
      .map((q) => ({
        code,
        stem: q.stem,
        a: q.choice_a,
        b: q.choice_b,
        c: q.choice_c,
        correct: q.correct,
        explanation: q.explanation,
      })),
  );
  return { cards, questions: qs };
}

function parseLooseJson(raw: string): { flashcards?: unknown; questions?: unknown } | null {
  let s = raw.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s) as { flashcards?: unknown; questions?: unknown };
  } catch {
    return null;
  }
}

function sanitizeCards(v: unknown): GenCard[] {
  if (!Array.isArray(v)) return [];
  const out: GenCard[] = [];
  for (const it of v) {
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const front = String(o.front ?? "").trim();
      const back = String(o.back ?? "").trim();
      const tags = String(o.tags ?? "").trim();
      if (front && back) out.push({ front, back, tags });
    }
  }
  return out;
}

function sanitizeQuestions(v: unknown): GenQuestion[] {
  if (!Array.isArray(v)) return [];
  const out: GenQuestion[] = [];
  for (const it of v) {
    if (it && typeof it === "object") {
      const o = it as Record<string, unknown>;
      const stem = String(o.stem ?? "").trim();
      const a = String(o.choice_a ?? "").trim();
      const b = String(o.choice_b ?? "").trim();
      const c = String(o.choice_c ?? "").trim();
      const correct = String(o.correct ?? "").trim().toUpperCase();
      const explanation = String(o.explanation ?? "").trim();
      if (stem && a && b && c && (correct === "A" || correct === "B" || correct === "C")) {
        out.push({ stem, choice_a: a, choice_b: b, choice_c: c, correct, explanation });
      }
    }
  }
  return out;
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
