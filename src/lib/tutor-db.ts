// Tutor persistence. Kept out of db.ts, which is already large.
import "server-only";
import { client, str, nowLocalISO, countsByTopic } from "./db";
import type { TutorContext } from "./tutor";

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export interface TutorMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  followups: string[];
  created_at: string;
}

export interface TutorSessionSummary {
  id: number;
  topic_code: string;
  title: string;
  updated_at: string;
  messages: number;
}

/** Card + SRS weak-point context for the first message of a session. */
export async function getTutorContext(cardId: number): Promise<TutorContext | null> {
  const r = await client.execute({
    sql: `SELECT f.front, f.back, f.tags, f.reps, f.ease, f.interval,
                 t.code AS topic_code, t.name AS topic_name, t.id AS topic_id,
                 (SELECT COUNT(*) FROM reviews v WHERE v.flashcard_id = f.id AND v.quality < 3) AS missed
          FROM flashcards f JOIN topics t ON t.id = f.topic_id
          WHERE f.id = ?`,
    args: [cardId],
  });
  if (!r.rows.length) return null;
  const row = r.rows[0];

  // Reuse countsByTopic so the tutor's numbers match the Dashboard exactly
  // (mature = interval >= 21, accuracy = SUM(is_correct)/COUNT(*)).
  const stats = await countsByTopic();
  const topicCode = str(row.topic_code);
  const s = stats.find((x) => x.code === topicCode);

  return {
    topicCode,
    topicName: str(row.topic_name),
    front: str(row.front),
    back: str(row.back),
    tags: str(row.tags),
    reps: num(row.reps),
    ease: num(row.ease),
    interval: num(row.interval),
    missed: num(row.missed),
    topicCards: s?.cards ?? 0,
    topicMature: s?.mature ?? 0,
    topicAttempts: s?.attempts ?? 0,
    topicCorrect: s?.correct ?? 0,
  };
}

export async function createSession(
  topicCode: string,
  cardId: number,
  title: string,
): Promise<number> {
  const now = nowLocalISO();
  const r = await client.execute({
    sql: `INSERT INTO tutor_sessions (topic_code, flashcard_id, title, created_at, updated_at)
          VALUES (?,?,?,?,?)`,
    args: [topicCode, cardId, title.slice(0, 120), now, now],
  });
  return Number(r.lastInsertRowid);
}

export async function addMessage(
  sessionId: number,
  role: "user" | "assistant",
  content: string,
  followups: string[] = [],
  model = "",
): Promise<number> {
  const now = nowLocalISO();
  const r = await client.execute({
    sql: `INSERT INTO tutor_messages (session_id, role, content, followups, model, created_at)
          VALUES (?,?,?,?,?,?)`,
    args: [sessionId, role, content, JSON.stringify(followups), model, now],
  });
  await client.execute({
    sql: "UPDATE tutor_sessions SET updated_at=? WHERE id=?",
    args: [now, sessionId],
  });
  return Number(r.lastInsertRowid);
}

/** Oldest-first. `limit` caps how much history we send to Claude. */
export async function getMessages(sessionId: number, limit = 8): Promise<TutorMessage[]> {
  const r = await client.execute({
    sql: `SELECT id, role, content, followups, created_at FROM tutor_messages
          WHERE session_id=? ORDER BY id DESC LIMIT ?`,
    args: [sessionId, limit],
  });
  return r.rows
    .map((row) => ({
      id: num(row.id),
      role: str(row.role) as "user" | "assistant",
      content: str(row.content),
      followups: safeJson(str(row.followups)),
      created_at: str(row.created_at),
    }))
    .reverse();
}

export async function listSessions(topicCode?: string | null): Promise<TutorSessionSummary[]> {
  const where = topicCode ? "WHERE s.topic_code = ?" : "";
  const r = await client.execute({
    sql: `SELECT s.id, s.topic_code, s.title, s.updated_at,
                 (SELECT COUNT(*) FROM tutor_messages m WHERE m.session_id = s.id) AS messages
          FROM tutor_sessions s ${where} ORDER BY s.updated_at DESC, s.id DESC LIMIT 50`,
    args: topicCode ? [topicCode] : [],
  });
  return r.rows.map((row) => ({
    id: num(row.id),
    topic_code: str(row.topic_code),
    title: str(row.title),
    updated_at: str(row.updated_at),
    messages: num(row.messages),
  }));
}

export async function getMessageWithTopic(
  messageId: number,
): Promise<{ content: string; topic_code: string; title: string } | null> {
  const r = await client.execute({
    sql: `SELECT m.content, s.topic_code, s.title FROM tutor_messages m
          JOIN tutor_sessions s ON s.id = m.session_id WHERE m.id = ?`,
    args: [messageId],
  });
  if (!r.rows.length) return null;
  return {
    content: str(r.rows[0].content),
    topic_code: str(r.rows[0].topic_code),
    title: str(r.rows[0].title),
  };
}

export async function saveTutorNote(
  topicCode: string,
  title: string,
  body: string,
  source: "answer" | "summary",
): Promise<number> {
  const r = await client.execute({
    sql: `INSERT INTO tutor_notes (topic_code, title, body, source, created_at) VALUES (?,?,?,?,?)`,
    args: [topicCode, title.slice(0, 120), body, source, nowLocalISO()],
  });
  return Number(r.lastInsertRowid);
}

export async function listTutorNotes(topicCode: string) {
  const r = await client.execute({
    sql: `SELECT id, topic_code, title, body, source, created_at FROM tutor_notes
          WHERE topic_code=? ORDER BY id DESC`,
    args: [topicCode],
  });
  return r.rows.map((row) => ({
    id: num(row.id),
    topic_code: str(row.topic_code),
    title: str(row.title),
    body: str(row.body),
    source: str(row.source),
    created_at: str(row.created_at),
  }));
}

/** Transcript of several sessions, for the summariser. */
export async function transcriptFor(sessionIds: number[]): Promise<{ topicCode: string; text: string }> {
  if (!sessionIds.length) return { topicCode: "", text: "" };
  const marks = sessionIds.map(() => "?").join(",");
  const r = await client.execute({
    sql: `SELECT s.topic_code, m.role, m.content FROM tutor_messages m
          JOIN tutor_sessions s ON s.id = m.session_id
          WHERE m.session_id IN (${marks}) ORDER BY m.session_id, m.id`,
    args: sessionIds,
  });
  const topicCode = r.rows.length ? str(r.rows[0].topic_code) : "";
  const text = r.rows
    .map((row) => `${str(row.role) === "user" ? "Q" : "A"}: ${str(row.content)}`)
    .join("\n\n");
  return { topicCode, text };
}

function safeJson(s: string): string[] {
  if (!s) return [];
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
