// Database layer (libSQL / Turso). Ported from the original db.py.
// In development this talks to a local SQLite file (file:cfa_study.db); in
// production set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN to point at Turso.
import "server-only";
import {
  createClient,
  type Client,
  type InValue,
} from "@libsql/client";
import { TOPICS } from "./topics";
import type {
  Flashcard,
  Question,
  RecentAttempt,
  Topic,
  TopicStat,
} from "./types";

// ---------------------------------------------------------------- client
const url = process.env.TURSO_DATABASE_URL || "file:cfa_study.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

// Reuse one client across hot-reloads / warm lambda invocations.
const globalForDb = globalThis as unknown as { _cfaClient?: Client };
const client: Client =
  globalForDb._cfaClient ??
  createClient(authToken ? { url, authToken } : { url });
globalForDb._cfaClient = client;

// ---------------------------------------------------------------- dates
// Compute "today" and timestamps in the user's timezone so due-dates and
// streaks line up with their local day, regardless of the server's timezone.
// Trim + validate so a stray space/tab or typo in the APP_TZ env var can never
// crash the app (falls back to Asia/Bangkok).
const APP_TZ = resolveTimeZone(process.env.APP_TZ);

function resolveTimeZone(raw: string | undefined): string {
  const tz = (raw || "Asia/Bangkok").trim();
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return tz;
  } catch {
    return "Asia/Bangkok";
  }
}

export function todayISO(): string {
  // en-CA formats as YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

function nowLocalISO(): string {
  // sv-SE formats as 'YYYY-MM-DD HH:mm:ss'
  return new Date()
    .toLocaleString("sv-SE", { timeZone: APP_TZ })
    .replace(" ", "T");
}

export function addDaysISO(baseISO: string, days: number): string {
  const d = new Date(baseISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------- schema
let initPromise: Promise<void> | null = null;

export function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      weight_low INTEGER NOT NULL,
      weight_high INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS flashcards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      tags TEXT DEFAULT '',
      ease REAL DEFAULT 2.5,
      interval INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0,
      due_date TEXT,
      last_reviewed TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      stem TEXT NOT NULL,
      choice_a TEXT NOT NULL,
      choice_b TEXT NOT NULL,
      choice_c TEXT NOT NULL,
      correct TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flashcard_id INTEGER REFERENCES flashcards(id) ON DELETE CASCADE,
      quality INTEGER,
      reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
      topic_id INTEGER REFERENCES topics(id) ON DELETE CASCADE,
      chosen TEXT,
      is_correct INTEGER,
      answered_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS explanations (
      question_id INTEGER PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      model TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_code TEXT NOT NULL,
      reading_no INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT,
      UNIQUE(topic_code, reading_no)
    );
  `);

  // Seed the 10 topics if missing. INSERT OR IGNORE keeps this idempotent and
  // safe even if two cold lambdas initialize at once (code is UNIQUE).
  await client.batch(
    TOPICS.map((t) => ({
      sql: "INSERT OR IGNORE INTO topics (code, name, weight_low, weight_high) VALUES (?,?,?,?)",
      args: [t.code, t.name, t.low, t.high],
    })),
    "write",
  );
}

// ---------------------------------------------------------------- helpers
type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);
const str = (v: unknown): string => (v == null ? "" : String(v));

async function topicIdByCode(code: string): Promise<number | null> {
  const r = await client.execute({
    sql: "SELECT id FROM topics WHERE code = ?",
    args: [code.trim().toUpperCase()],
  });
  return r.rows.length ? num(r.rows[0].id) : null;
}

function mapCard(row: Row): Flashcard {
  return {
    id: num(row.id),
    topic_id: num(row.topic_id),
    topic_code: str(row.topic_code),
    front: str(row.front),
    back: str(row.back),
    tags: str(row.tags),
    ease: num(row.ease),
    interval: num(row.interval),
    reps: num(row.reps),
    due_date: row.due_date == null ? null : str(row.due_date),
    last_reviewed: row.last_reviewed == null ? null : str(row.last_reviewed),
    created_at: row.created_at == null ? null : str(row.created_at),
  };
}

function mapQuestion(row: Row): Question {
  return {
    id: num(row.id),
    topic_id: num(row.topic_id),
    topic_code: str(row.topic_code),
    stem: str(row.stem),
    choice_a: str(row.choice_a),
    choice_b: str(row.choice_b),
    choice_c: str(row.choice_c),
    correct: (str(row.correct) || "A") as "A" | "B" | "C",
    explanation: str(row.explanation),
    created_at: row.created_at == null ? null : str(row.created_at),
  };
}

// ---------------------------------------------------------------- topics
export async function listTopics(): Promise<Topic[]> {
  const r = await client.execute("SELECT * FROM topics ORDER BY id");
  return r.rows.map((row) => ({
    id: num(row.id),
    code: str(row.code),
    name: str(row.name),
    weight_low: num(row.weight_low),
    weight_high: num(row.weight_high),
  }));
}

// ---------------------------------------------------------------- flashcards
export async function addFlashcard(
  code: string,
  front: string,
  back: string,
  tags = "",
): Promise<boolean> {
  const tid = await topicIdByCode(code);
  if (tid == null) return false;
  await client.execute({
    sql: `INSERT INTO flashcards (topic_id, front, back, tags, due_date, created_at)
          VALUES (?,?,?,?,?,?)`,
    args: [tid, front, back, tags, todayISO(), nowLocalISO()],
  });
  return true;
}

export async function dueFlashcards(
  code?: string | null,
  limit?: number,
): Promise<Flashcard[]> {
  let sql = `SELECT f.*, t.code AS topic_code FROM flashcards f
             JOIN topics t ON f.topic_id = t.id
             WHERE (f.due_date IS NULL OR f.due_date <= ?)`;
  const args: InValue[] = [todayISO()];
  if (code) {
    sql += " AND t.code = ?";
    args.push(code.trim().toUpperCase());
  }
  sql += " ORDER BY f.due_date IS NOT NULL, f.due_date, RANDOM()";
  if (limit && Number.isFinite(limit)) sql += ` LIMIT ${Math.trunc(limit)}`;
  const r = await client.execute({ sql, args });
  return r.rows.map(mapCard);
}

export async function allCards(code?: string | null): Promise<Flashcard[]> {
  let sql = `SELECT f.*, t.code AS topic_code FROM flashcards f
             JOIN topics t ON f.topic_id = t.id`;
  const args: InValue[] = [];
  if (code) {
    sql += " WHERE t.code = ?";
    args.push(code.trim().toUpperCase());
  }
  sql += " ORDER BY f.topic_id, f.id";
  const r = await client.execute({ sql, args });
  return r.rows.map(mapCard);
}

export async function getFlashcardState(
  cardId: number,
): Promise<{ ease: number; interval: number; reps: number } | null> {
  const r = await client.execute({
    sql: "SELECT ease, interval, reps FROM flashcards WHERE id=?",
    args: [cardId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return { ease: num(row.ease), interval: num(row.interval), reps: num(row.reps) };
}

export async function bulkAddFlashcards(
  items: { code: string; front: string; back: string; tags: string }[],
): Promise<number> {
  if (!items.length) return 0;
  const topics = await listTopics();
  const idByCode = new Map(topics.map((t) => [t.code, t.id]));
  const today = todayISO();
  const now = nowLocalISO();
  const stmts = items
    .map((it) => {
      const tid = idByCode.get(it.code.trim().toUpperCase());
      if (tid == null) return null;
      return {
        sql: `INSERT INTO flashcards (topic_id, front, back, tags, due_date, created_at) VALUES (?,?,?,?,?,?)`,
        args: [tid, it.front, it.back, it.tags, today, now] as InValue[],
      };
    })
    .filter((s): s is { sql: string; args: InValue[] } => s !== null);
  if (!stmts.length) return 0;
  await client.batch(stmts, "write");
  return stmts.length;
}

export async function updateCardSchedule(
  cardId: number,
  ease: number,
  interval: number,
  reps: number,
  dueDate: string,
  quality: number,
): Promise<void> {
  const now = nowLocalISO();
  await client.batch(
    [
      {
        sql: `UPDATE flashcards SET ease=?, interval=?, reps=?, due_date=?, last_reviewed=? WHERE id=?`,
        args: [ease, interval, reps, dueDate, now, cardId],
      },
      {
        sql: "INSERT INTO reviews (flashcard_id, quality, reviewed_at) VALUES (?,?,?)",
        args: [cardId, quality, now],
      },
    ],
    "write",
  );
}

export async function deleteFlashcard(cardId: number): Promise<void> {
  await client.execute({ sql: "DELETE FROM flashcards WHERE id=?", args: [cardId] });
}

// ---------------------------------------------------------------- questions
export async function addQuestion(
  code: string,
  stem: string,
  a: string,
  b: string,
  c: string,
  correct: string,
  explanation = "",
): Promise<boolean> {
  const tid = await topicIdByCode(code);
  if (tid == null) return false;
  await client.execute({
    sql: `INSERT INTO questions (topic_id, stem, choice_a, choice_b, choice_c, correct, explanation, created_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [tid, stem, a, b, c, correct.trim().toUpperCase(), explanation, nowLocalISO()],
  });
  return true;
}

export async function bulkAddQuestions(
  items: {
    code: string;
    stem: string;
    a: string;
    b: string;
    c: string;
    correct: string;
    explanation: string;
  }[],
): Promise<number> {
  if (!items.length) return 0;
  const topics = await listTopics();
  const idByCode = new Map(topics.map((t) => [t.code, t.id]));
  const now = nowLocalISO();
  const stmts = items
    .map((it) => {
      const tid = idByCode.get(it.code.trim().toUpperCase());
      if (tid == null) return null;
      return {
        sql: `INSERT INTO questions (topic_id, stem, choice_a, choice_b, choice_c, correct, explanation, created_at) VALUES (?,?,?,?,?,?,?,?)`,
        args: [tid, it.stem, it.a, it.b, it.c, it.correct.trim().toUpperCase(), it.explanation, now] as InValue[],
      };
    })
    .filter((s): s is { sql: string; args: InValue[] } => s !== null);
  if (!stmts.length) return 0;
  await client.batch(stmts, "write");
  return stmts.length;
}

export async function getQuestions(
  code?: string | null,
  limit?: number,
  randomOrder = true,
): Promise<Question[]> {
  let sql = `SELECT q.*, t.code AS topic_code FROM questions q
             JOIN topics t ON q.topic_id = t.id`;
  const args: InValue[] = [];
  if (code) {
    sql += " WHERE t.code = ?";
    args.push(code.trim().toUpperCase());
  }
  sql += randomOrder ? " ORDER BY RANDOM()" : " ORDER BY q.id";
  if (limit && Number.isFinite(limit)) sql += ` LIMIT ${Math.trunc(limit)}`;
  const r = await client.execute({ sql, args });
  return r.rows.map(mapQuestion);
}

export async function recordAttempt(
  questionId: number,
  topicId: number,
  chosen: string,
  isCorrect: boolean,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO attempts (question_id, topic_id, chosen, is_correct, answered_at)
          VALUES (?,?,?,?,?)`,
    args: [questionId, topicId, chosen, isCorrect ? 1 : 0, nowLocalISO()],
  });
}

export async function deleteQuestion(questionId: number): Promise<void> {
  await client.execute({ sql: "DELETE FROM questions WHERE id=?", args: [questionId] });
}

// ---------------------------------------------------------------- stats
export async function countsByTopic(): Promise<TopicStat[]> {
  const today = todayISO();
  const topics = await listTopics();

  const [cards, due, mature, qs, att] = await client.batch(
    [
      "SELECT topic_id, COUNT(*) AS n FROM flashcards GROUP BY topic_id",
      {
        sql: "SELECT topic_id, COUNT(*) AS n FROM flashcards WHERE due_date IS NULL OR due_date<=? GROUP BY topic_id",
        args: [today],
      },
      "SELECT topic_id, COUNT(*) AS n FROM flashcards WHERE interval>=21 GROUP BY topic_id",
      "SELECT topic_id, COUNT(*) AS n FROM questions GROUP BY topic_id",
      "SELECT topic_id, COUNT(*) AS n, COALESCE(SUM(is_correct),0) AS c FROM attempts GROUP BY topic_id",
    ],
    "read",
  );

  const toMap = (rows: Row[], key = "n") => {
    const m = new Map<number, number>();
    for (const r of rows) m.set(num(r.topic_id), num(r[key]));
    return m;
  };
  const cardsM = toMap(cards.rows);
  const dueM = toMap(due.rows);
  const matureM = toMap(mature.rows);
  const qsM = toMap(qs.rows);
  const attM = toMap(att.rows);
  const corrM = toMap(att.rows, "c");

  return topics.map((t) => ({
    code: t.code,
    name: t.name,
    weight_low: t.weight_low,
    weight_high: t.weight_high,
    cards: cardsM.get(t.id) ?? 0,
    due: dueM.get(t.id) ?? 0,
    mature: matureM.get(t.id) ?? 0,
    questions: qsM.get(t.id) ?? 0,
    attempts: attM.get(t.id) ?? 0,
    correct: corrM.get(t.id) ?? 0,
  }));
}

export async function activityDates(): Promise<Set<string>> {
  const [rev, att] = await client.batch(
    [
      "SELECT DISTINCT substr(reviewed_at,1,10) AS d FROM reviews WHERE reviewed_at IS NOT NULL",
      "SELECT DISTINCT substr(answered_at,1,10) AS d FROM attempts WHERE answered_at IS NOT NULL",
    ],
    "read",
  );
  const days = new Set<string>();
  for (const r of rev.rows) if (r.d) days.add(str(r.d));
  for (const r of att.rows) if (r.d) days.add(str(r.d));
  return days;
}

export async function recentAttempts(limit = 20): Promise<RecentAttempt[]> {
  const r = await client.execute({
    sql: `SELECT a.is_correct, a.answered_at, q.stem, t.code AS topic_code
          FROM attempts a
          JOIN questions q ON a.question_id=q.id
          JOIN topics t ON a.topic_id=t.id
          ORDER BY a.answered_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map((row) => ({
    topic_code: str(row.topic_code),
    stem: str(row.stem),
    is_correct: num(row.is_correct),
    answered_at: str(row.answered_at),
  }));
}

// ---------------------------------------------------------------- habits
/** Cards reviewed and questions answered on a given local day (default today). */
export async function activityCountsForDay(
  day = todayISO(),
): Promise<{ cards: number; questions: number }> {
  const [rev, att] = await client.batch(
    [
      { sql: "SELECT COUNT(*) AS n FROM reviews WHERE substr(reviewed_at,1,10)=?", args: [day] },
      { sql: "SELECT COUNT(*) AS n FROM attempts WHERE substr(answered_at,1,10)=?", args: [day] },
    ],
    "read",
  );
  return { cards: num(rev.rows[0]?.n), questions: num(att.rows[0]?.n) };
}

/** Per-day activity (reviews + attempts) on/after `sinceISO`, for the heatmap. */
export async function dailyActivity(sinceISO: string): Promise<Map<string, number>> {
  const [rev, att] = await client.batch(
    [
      {
        sql: "SELECT substr(reviewed_at,1,10) AS d, COUNT(*) AS n FROM reviews WHERE reviewed_at >= ? GROUP BY d",
        args: [sinceISO],
      },
      {
        sql: "SELECT substr(answered_at,1,10) AS d, COUNT(*) AS n FROM attempts WHERE answered_at >= ? GROUP BY d",
        args: [sinceISO],
      },
    ],
    "read",
  );
  const m = new Map<string, number>();
  for (const r of [...rev.rows, ...att.rows]) {
    const d = str(r.d);
    if (d) m.set(d, (m.get(d) ?? 0) + num(r.n));
  }
  return m;
}

export async function getSettingsRaw(): Promise<Record<string, string>> {
  const r = await client.execute("SELECT key, value FROM settings");
  const out: Record<string, string> = {};
  for (const row of r.rows) out[str(row.key)] = str(row.value);
  return out;
}

export async function setSettingsRaw(entries: Record<string, string>): Promise<void> {
  const stmts = Object.entries(entries).map(([k, v]) => ({
    sql: "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    args: [k, v] as InValue[],
  }));
  if (stmts.length) await client.batch(stmts, "write");
}

// ---------------------------------------------------------------- AI explanation cache
export async function getExplanation(
  questionId: number,
): Promise<{ text: string; model: string } | null> {
  const r = await client.execute({
    sql: "SELECT text, model FROM explanations WHERE question_id=?",
    args: [questionId],
  });
  if (!r.rows.length) return null;
  return { text: str(r.rows[0].text), model: str(r.rows[0].model) };
}

export async function saveExplanation(
  questionId: number,
  text: string,
  model: string,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO explanations (question_id, text, model, created_at) VALUES (?,?,?,?)
          ON CONFLICT(question_id) DO UPDATE SET text=excluded.text, model=excluded.model, created_at=excluded.created_at`,
    args: [questionId, text, model, nowLocalISO()],
  });
}

// ---------------------------------------------------------------- study notes
export interface Note {
  id: number;
  topic_code: string;
  reading_no: number;
  title: string;
  body: string;
}

function mapNote(row: Row): Note {
  return {
    id: num(row.id),
    topic_code: str(row.topic_code),
    reading_no: num(row.reading_no),
    title: str(row.title),
    body: str(row.body),
  };
}

/** Count of readings (notes) per topic code, for the Notes overview. */
export async function notesCountsByTopic(): Promise<
  { topic_code: string; count: number }[]
> {
  const r = await client.execute(
    "SELECT topic_code, COUNT(*) AS count FROM notes GROUP BY topic_code",
  );
  return r.rows.map((row) => ({
    topic_code: str(row.topic_code),
    count: num(row.count),
  }));
}

/** All study notes for one topic, ordered by reading number. */
export async function notesByTopic(code: string): Promise<Note[]> {
  const r = await client.execute({
    sql: "SELECT * FROM notes WHERE topic_code=? ORDER BY reading_no ASC",
    args: [code.trim().toUpperCase()],
  });
  return r.rows.map(mapNote);
}

/** Full-text-ish search across all notes (title + body), case-insensitive. */
export async function searchNotes(q: string): Promise<Note[]> {
  const term = q.trim();
  if (!term) return [];
  // Escape LIKE wildcards so a literal % or _ in the query isn't treated as a pattern.
  const esc = term.replace(/[\\%_]/g, (m) => "\\" + m);
  const like = `%${esc}%`;
  const r = await client.execute({
    sql: `SELECT * FROM notes
          WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
          ORDER BY topic_code ASC, reading_no ASC`,
    args: [like, like],
  });
  return r.rows.map(mapNote);
}

/** Idempotent upsert of study notes (UNIQUE on topic_code + reading_no). */
export async function bulkUpsertNotes(
  items: { topic_code: string; reading_no: number; title: string; body: string }[],
): Promise<number> {
  if (!items.length) return 0;
  const now = nowLocalISO();
  const stmts = items
    .filter((it) => it.topic_code && it.title && it.body)
    .map((it) => ({
      sql: `INSERT INTO notes (topic_code, reading_no, title, body, created_at) VALUES (?,?,?,?,?)
            ON CONFLICT(topic_code, reading_no) DO UPDATE SET title=excluded.title, body=excluded.body, created_at=excluded.created_at`,
      args: [
        it.topic_code.trim().toUpperCase(),
        it.reading_no,
        it.title,
        it.body,
        now,
      ] as InValue[],
    }));
  if (!stmts.length) return 0;
  await client.batch(stmts, "write");
  return stmts.length;
}
