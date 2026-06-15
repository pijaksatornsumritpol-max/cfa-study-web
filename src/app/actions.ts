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
  bulkUpsertNotes,
  countsByTopic,
  dailyActivity,
  deleteFlashcard,
  deleteQuestion,
  dueFlashcards,
  ensureInit,
  examHistory,
  saveExamAttempt,
  getExplanation,
  getFlashcardState,
  getQuestions,
  getSettingsRaw,
  notesByTopic,
  notesCountsByTopic,
  searchNotes as searchNotesDb,
  wrongQuestions,
  wrongCount,
  recentAttempts,
  recordAttempt,
  saveExplanation,
  savePushSubscription,
  deletePushSubscription,
  pushSubscriptionCount,
  setSettingsRaw,
  todayISO,
  updateCardSchedule,
} from "@/lib/db";
import type { ExamAttempt, Note } from "@/lib/db";
import {
  pushConfigured,
  vapidPublicKey,
  sendToAll,
  buildDailyReminder,
} from "@/lib/push";
import { schedule } from "@/lib/srs";
import { buildHeatmap, parseSettings, type HabitSettings } from "@/lib/habits";
import { buildPlan, type StudyPlan } from "@/lib/plan";
import {
  googleConfigured,
  serviceAccountEmail,
  calendarId,
  syncPlanEvents,
  type CalEvent,
} from "@/lib/google";
import { SAMPLE_CARDS, SAMPLE_QUESTIONS } from "@/lib/seed-data";
import { CODE_TO_NAME, TOPIC_CODES, TOPICS } from "@/lib/topics";
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

export async function getStudyPlan(): Promise<{
  plan: StudyPlan;
  streak: number;
  reward: string;
  examDate: string;
}> {
  await ensureInit();
  const today = todayISO();
  const settings = parseSettings(await getSettingsRaw());
  const stats = await countsByTopic();
  const days = await activityDates();
  const plan = buildPlan(
    settings.examDate,
    today,
    stats.map((s) => ({
      code: s.code,
      name: s.name,
      weight_low: s.weight_low,
      weight_high: s.weight_high,
      questions: s.questions,
      attempts: s.attempts,
      correct: s.correct,
      mature: s.mature,
    })),
  );
  return {
    plan,
    streak: computeStreak(days),
    reward: settings.reward,
    examDate: settings.examDate,
  };
}

// ---------------------------------------------------------------- google calendar
export async function googleAuthStatus(): Promise<{
  configured: boolean;
  serviceEmail: string;
  calendarId: string;
}> {
  return {
    configured: googleConfigured(),
    serviceEmail: serviceAccountEmail(),
    calendarId: calendarId(),
  };
}

/** Push the current study plan (topic blocks + review phase + exam day) to Google Calendar. */
export async function pushPlanToCalendar(): Promise<{
  ok: boolean;
  created?: number;
  error?: string;
}> {
  await ensureInit();
  if (!googleConfigured())
    return { ok: false, error: "Google Calendar isn't configured on the server yet." };

  const settings = parseSettings(await getSettingsRaw());
  if (!settings.examDate) return { ok: false, error: "Set your exam date first." };

  const stats = await countsByTopic();
  const plan = buildPlan(
    settings.examDate,
    todayISO(),
    stats.map((s) => ({
      code: s.code,
      name: s.name,
      weight_low: s.weight_low,
      weight_high: s.weight_high,
      questions: s.questions,
      attempts: s.attempts,
      correct: s.correct,
      mature: s.mature,
    })),
  );

  const events: CalEvent[] = [];
  const reviewBlocks = plan.schedule.filter((b) => b.kind === "review");
  for (const b of plan.schedule) {
    if (b.kind === "review") continue; // merged below
    events.push({
      summary: `📚 CFA — ${CODE_TO_NAME[b.codes[0]] ?? b.codes[0]}`,
      description: b.label,
      startDate: b.startISO,
      endDateExclusive: addDaysISO(b.endISO, 1),
    });
  }
  if (reviewBlocks.length) {
    events.push({
      summary: "📝 CFA — Review + Mock Exams",
      description: "Review weak topics and take full timed Simulations; clear your mistakes.",
      startDate: reviewBlocks[0].startISO,
      endDateExclusive: addDaysISO(reviewBlocks[reviewBlocks.length - 1].endISO, 1),
    });
  }
  events.push({
    summary: "🎓 CFA Level 1 Exam",
    description: "Exam day — good luck!",
    startDate: settings.examDate,
    endDateExclusive: addDaysISO(settings.examDate, 1),
  });

  try {
    const created = await syncPlanEvents(events);
    return { ok: true, created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "calendar sync failed" };
  }
}

// ---------------------------------------------------------------- push notifications
export async function getPushConfig(): Promise<{
  configured: boolean;
  publicKey: string;
  subscribers: number;
}> {
  await ensureInit();
  return {
    configured: pushConfigured(),
    publicKey: vapidPublicKey(),
    subscribers: await pushSubscriptionCount(),
  };
}

/** Store a browser's Web Push subscription so the daily cron can notify it. */
export async function savePushSub(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<{ ok: boolean }> {
  await ensureInit();
  if (!sub.endpoint || !sub.p256dh || !sub.auth) return { ok: false };
  await savePushSubscription(sub);
  return { ok: true };
}

export async function removePushSub(endpoint: string): Promise<{ ok: boolean }> {
  await ensureInit();
  if (endpoint) await deletePushSubscription(endpoint);
  return { ok: true };
}

/** Fire the real daily reminder right now (so the user can preview it on enable). */
export async function sendTestPush(): Promise<{
  ok: boolean;
  sent?: number;
  total?: number;
  error?: string;
}> {
  await ensureInit();
  if (!pushConfigured())
    return { ok: false, error: "Push notifications aren't configured on the server yet." };
  const payload = await buildDailyReminder();
  const res = await sendToAll({ ...payload, tag: "cfa-test" });
  return { ok: true, sent: res.sent, total: res.total };
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

// Extract plain text from an uploaded file (PDF, Excel, CSV, or text) so it can
// be fed to the generator. Receives a base64 data URL from the browser.
export async function extractFileText(
  dataUrl: string,
  filename: string,
): Promise<{ text?: string; pages?: number; truncated?: boolean; error?: string }> {
  try {
    const comma = dataUrl.indexOf(",");
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length === 0) return { error: "The file appears to be empty." };
    if (bytes.length > 8 * 1024 * 1024)
      return { error: "File too large (max ~8 MB). Upload a smaller section." };

    const ext = (filename.split(".").pop() || "").toLowerCase();
    const CAP = 40000;
    let text = "";
    let pages: number | undefined;

    if (ext === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const res = await extractText(pdf, { mergePages: true });
      pages = res.totalPages;
      text = res.text;
    } else if (ext === "xlsx" || ext === "xls") {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(bytes, { type: "buffer" });
      text = wb.SheetNames.map((n) => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n");
    } else {
      text = bytes.toString("utf8");
    }

    text = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
    if (!text) return { error: "No readable text could be extracted from this file." };
    const truncated = text.length > CAP;
    return { text: truncated ? text.slice(0, CAP) : text, pages, truncated };
  } catch (e) {
    return { error: "Could not read the file. " + String(e).slice(0, 150) };
  }
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

/** A quiz built only from questions whose latest attempt was wrong (review mode). */
export async function getMistakesQuiz(
  code: string | null,
  n: number,
): Promise<Question[]> {
  await ensureInit();
  return wrongQuestions(code ?? null, n);
}

/** How many "mistake" questions are available (overall, or for a topic). */
export async function getMistakesCount(code: string | null): Promise<number> {
  await ensureInit();
  return wrongCount(code ?? null);
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

// ---------------------------------------------------------------- study notes
export async function browseNotes(code: string): Promise<Note[]> {
  await ensureInit();
  if (!code || !TOPIC_CODES.includes(code.trim().toUpperCase())) return [];
  return notesByTopic(code);
}

export async function notesOverview(): Promise<Record<string, number>> {
  await ensureInit();
  const counts = await notesCountsByTopic();
  return Object.fromEntries(counts.map((c) => [c.topic_code, c.count]));
}

export async function searchNotes(query: string): Promise<Note[]> {
  await ensureInit();
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  return searchNotesDb(q);
}

// ---------------------------------------------------------------- exam simulation
/** Questions available per topic + total, for the simulation setup screen. */
export async function simulationAvailability(): Promise<{
  total: number;
  byTopic: Record<string, number>;
}> {
  await ensureInit();
  const stats = await countsByTopic();
  const byTopic: Record<string, number> = {};
  let total = 0;
  for (const s of stats) {
    byTopic[s.code] = s.questions;
    total += s.questions;
  }
  return { total, byTopic };
}

/** Build a mock exam of n questions, allocated across topics by official CFA
 *  weights (capped by availability), then shuffled. */
export async function startSimulation(n = 90): Promise<Question[]> {
  await ensureInit();
  const stats = await countsByTopic();
  const avail: Record<string, number> = {};
  for (const s of stats) avail[s.code] = s.questions;

  const mids = TOPICS.map((t) => ({ code: t.code, w: (t.low + t.high) / 2 }));
  const sumW = mids.reduce((a, m) => a + m.w, 0);

  const target: Record<string, number> = {};
  for (const m of mids) {
    target[m.code] = Math.min(avail[m.code] ?? 0, Math.round((n * m.w) / sumW));
  }
  let allocated = Object.values(target).reduce((a, b) => a + b, 0);

  // Fill any shortfall (from rounding or empty topics) using topics with spare capacity.
  while (allocated < n) {
    let progressed = false;
    for (const m of mids) {
      if (allocated >= n) break;
      if (target[m.code] < (avail[m.code] ?? 0)) {
        target[m.code] += 1;
        allocated += 1;
        progressed = true;
      }
    }
    if (!progressed) break; // bank doesn't have n questions total
  }
  // Trim any overflow from rounding.
  while (allocated > n) {
    for (const m of mids) {
      if (allocated <= n) break;
      if (target[m.code] > 0) {
        target[m.code] -= 1;
        allocated -= 1;
      }
    }
  }

  const out: Question[] = [];
  for (const m of mids) {
    const k = target[m.code] ?? 0;
    if (k > 0) out.push(...(await getQuestions(m.code, k, true)));
  }
  // Shuffle the combined set (Fisher-Yates).
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function saveSimulation(a: {
  started_at: string;
  finished_at: string;
  duration_sec: number;
  total: number;
  correct: number;
  breakdown: Record<string, [number, number]>;
}): Promise<number> {
  await ensureInit();
  return saveExamAttempt(a);
}

export async function getSimulationHistory(): Promise<ExamAttempt[]> {
  await ensureInit();
  return examHistory(25);
}

/** Used by the temporary seed-import route to load study notes into the bank. */
export async function importNotesJson(
  json: string,
): Promise<{ added: number; skipped: number }> {
  await ensureInit();
  let items: { topic_code: string; reading_no: number; title: string; body: string }[];
  try {
    items = JSON.parse(json);
  } catch {
    return { added: 0, skipped: 0 };
  }
  const valid = items.filter(
    (it) =>
      it &&
      TOPIC_CODES.includes(String(it.topic_code).trim().toUpperCase()) &&
      Number.isFinite(it.reading_no) &&
      String(it.title).trim() &&
      String(it.body).trim(),
  );
  const added = await bulkUpsertNotes(valid);
  return { added, skipped: items.length - added };
}
