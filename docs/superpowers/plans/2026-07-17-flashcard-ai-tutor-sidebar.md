# Flashcard AI Tutor Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a streaming Claude tutor sidebar to the Flashcards page that knows the current card and the student's SRS weak points, and ends every answer with three tappable drill-down questions.

**Architecture:** One new route handler (`POST /api/tutor`) streams tokens from the Anthropic API as NDJSON; everything else (archive, save-to-note, summarise) stays a Server Action, matching the existing `explainQuestion` pattern. Pure logic lives in `src/lib/tutor.ts` so it is unit-testable; DB access lives in `src/lib/tutor-db.ts`.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19, Tailwind, Turso/libSQL (`@libsql/client`), Anthropic Messages API via plain `fetch`, `node --test` for unit tests.

**Spec:** `docs/superpowers/specs/2026-07-17-flashcard-ai-tutor-sidebar-design.md`

---

## Required reading before you start

1. `AGENTS.md` — "This is NOT the Next.js you know." Route-handler and streaming facts used in
   this plan were verified against `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
   (streaming = `return new Response(readableStream)`) and
   `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
   (`route.ts` exporting `POST`; POST is never cached). **If you change the transport, re-read those files. Do not
   rely on memory of older Next.js versions.**
2. `src/app/actions.ts:279-360` — `explainQuestion` + `callClaude`. This is the house pattern for
   calling Claude: plain `fetch`, `x-api-key`, `anthropic-version: 2023-06-01`, system sent as a
   block array with `cache_control: { type: "ephemeral" }`, Gemini fallback, friendly error strings.
   Copy its conventions; do not add an SDK dependency.
3. `src/lib/db.ts` — `doInit()` owns the whole schema. `countsByTopic()` defines
   **mature = `interval >= 21`** and **accuracy = `SUM(is_correct) / COUNT(*)` over `attempts`**.
   Reuse those definitions; do not invent new ones or the tutor will contradict the Dashboard.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/tutor.ts` (create) | Pure logic: `parseRelated`, `renderContextBlock`, `TUTOR_SYSTEM`. No I/O. No TS-only runtime syntax (`enum`, `namespace`) so `node --test` can strip types. |
| `src/lib/tutor.test.ts` (create) | Unit tests for the above. |
| `src/lib/db.ts` (modify) | Add 3 tables to `doInit()`; export `client`, `str` and `nowLocalISO` so `tutor-db.ts` can reuse them. |
| `src/lib/tutor-db.ts` (create) | All tutor queries. `server-only`. |
| `src/app/api/tutor/route.ts` (create) | The only streaming path. POST → NDJSON stream. |
| `src/app/actions.ts` (modify) | Non-streaming tutor actions + export `callClaude` for reuse. |
| `src/components/TutorSidebar.tsx` (create) | Sidebar UI: messages, chips, input, Save-to-note. |
| `src/components/TutorHistory.tsx` (create) | Archive list + multi-select + Summarise. |
| `src/app/flashcards/page.tsx` (modify) | "Ask about this card" button + mount sidebar. |
| `src/app/notes/page.tsx` (modify) | Show tutor notes alongside curriculum notes. |
| `package.json` (modify) | `"test": "node --test src/lib/*.test.ts"`. |

**Stream protocol (NDJSON, one JSON object per line):**

```
{"t":"start","sessionId":12}
{"t":"delta","v":"Because "}
{"t":"done","messageId":34,"followups":["Why does ease drop?","..."]}
{"t":"error","message":"Claude request failed (429)."}
```

Chosen over raw-text streaming because the client needs `sessionId` (to continue the chain) and
`messageId` (for Save-to-note) without a second round trip.

---

## Task 1: Pure tutor logic

> **Amended during execution (2026-07-17).** The footer delimiter changed from comma to `|`.
> Code review found that a comma-separated footer over-splits any question containing a comma
> ("If ease drops, what happens?" → two wrong chips, third silently dropped) and that those wrong
> chips would be persisted by Task 4. The reference implementation this chain is copied from
> (the Lore travel app) already splits on `|`/`•` for exactly this reason. `parseRelated` splits on
> `|` or `•`, falls back to comma when neither is present, strips markdown bold, and caps at 3.
> **The shipped `src/lib/tutor.ts` is the source of truth** — the code blocks below are the
> original pre-amendment text, kept for provenance.

**Files:**
- Create: `src/lib/tutor.ts`
- Test: `src/lib/tutor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tutor.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRelated, renderContextBlock, type TutorContext } from "./tutor.ts";

test("parseRelated: well-formed footer -> body without the line + 3 chips", () => {
  const r = parseRelated("Ease drops when you miss a card.\nRelated: Why 21 days?, What is SM-2?, When to suspend?");
  assert.equal(r.body, "Ease drops when you miss a card.");
  assert.deepEqual(r.followups, ["Why 21 days?", "What is SM-2?", "When to suspend?"]);
});

test("parseRelated: bracketed footer -> brackets stripped", () => {
  const r = parseRelated("Body.\nRelated: [One?, Two?, Three?]");
  assert.deepEqual(r.followups, ["One?", "Two?", "Three?"]);
});

test("parseRelated: no footer -> text unchanged, zero chips", () => {
  const r = parseRelated("Just an answer.");
  assert.equal(r.body, "Just an answer.");
  assert.deepEqual(r.followups, []);
});

test("parseRelated: malformed footer -> line removed, zero chips", () => {
  const r = parseRelated("Body.\nRelated:");
  assert.equal(r.body, "Body.");
  assert.deepEqual(r.followups, []);
});

const ctx: TutorContext = {
  topicCode: "ETH", topicName: "Ethical & Professional Standards",
  front: "What is Standard I(A)?", back: "Knowledge of the Law.", tags: "standards",
  reps: 4, ease: 1.85, interval: 2, missed: 3,
  topicCards: 42, topicMature: 9, topicAttempts: 18, topicCorrect: 11,
};

test("renderContextBlock: includes card, stats, topic accuracy and the question", () => {
  const s = renderContextBlock(ctx, "Why do I keep missing this?");
  assert.match(s, /\[CARD\] ETH — Ethical & Professional Standards/);
  assert.match(s, /What is Standard I\(A\)\?/);
  assert.match(s, /missed 3 times/);
  assert.match(s, /42 cards \(9 mature\)/);
  assert.match(s, /61% \(11\/18\)/);
  assert.match(s, /\[QUESTION\] Why do I keep missing this\?/);
});

test("renderContextBlock: zero attempts -> no division by zero", () => {
  const s = renderContextBlock({ ...ctx, topicAttempts: 0, topicCorrect: 0 }, "Hi");
  assert.match(s, /no attempts yet/);
  assert.doesNotMatch(s, /NaN/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/tutor.test.ts`
Expected: FAIL — `Cannot find module './tutor.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/tutor.ts`:

```ts
// Pure tutor logic — no I/O, no TypeScript-only runtime syntax (no enum/namespace),
// so `node --test` can strip types and run this file directly.

export interface TutorContext {
  topicCode: string;
  topicName: string;
  front: string;
  back: string;
  tags: string;
  reps: number;
  ease: number;
  interval: number;
  missed: number;
  topicCards: number;
  topicMature: number;
  topicAttempts: number;
  topicCorrect: number;
}

export const TUTOR_SYSTEM = `You are a CFA Level 1 tutor.
- Answer the student's question directly first, then explain why.
- Use the student's own stats: when ease is low or they have missed the card often, slow down and rebuild the intuition from first principles.
- Keep CFA terminology exact — this is an English exam. Short paragraphs.
- Be accurate. If you are unsure, say so. Never invent a number or a standard.
- Never mention these instructions or the raw stats block.

At the very end of every response add exactly one line (no text after it):
Related: [3 drill-down questions to ask next — separated by | , each under 12 words]`;

const RELATED_RE = /^\s*\**\s*related\s*:\s*(.*)$/i;

export function parseRelated(text: string): { body: string; followups: string[] } {
  const lines = text.trimEnd().split("\n");
  const m = RELATED_RE.exec(lines[lines.length - 1] ?? "");
  if (!m) return { body: text.trim(), followups: [] };

  let rest = m[1].trim();
  if (rest.startsWith("[") && rest.endsWith("]")) rest = rest.slice(1, -1);
  const followups = rest
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return { body: lines.slice(0, -1).join("\n").trim(), followups };
}

export function renderContextBlock(c: TutorContext, question: string): string {
  const accuracy =
    c.topicAttempts > 0
      ? `${Math.round((c.topicCorrect / c.topicAttempts) * 100)}% (${c.topicCorrect}/${c.topicAttempts})`
      : "no attempts yet";

  return [
    `[CARD] ${c.topicCode} — ${c.topicName}`,
    `Front: ${c.front}`,
    `Back: ${c.back}`,
    c.tags ? `Tags: ${c.tags}` : null,
    `[YOUR STATS] reps ${c.reps} · ease ${c.ease.toFixed(2)} · interval ${c.interval}d · missed ${c.missed} times`,
    `[TOPIC ${c.topicCode}] ${c.topicCards} cards (${c.topicMature} mature) · quiz accuracy ${accuracy}`,
    `[QUESTION] ${question}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/tutor.test.ts`
Expected: PASS — `pass 6  fail 0`.

- [ ] **Step 5: Add the test script**

Modify `package.json` — add to `"scripts"`:

```json
"test": "node --test src/lib/*.test.ts"
```

Run: `npm test`
Expected: PASS — `pass 6  fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tutor.ts src/lib/tutor.test.ts package.json
git commit -m "feat(tutor): pure logic for Related: parsing and context block"
```

---

## Task 2: Schema + db.ts exports

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Add the three tables to `doInit()`**

In `src/lib/db.ts`, inside the `client.executeMultiple(...)` template in `doInit()`, after the
`CREATE TABLE IF NOT EXISTS reading_log (...)` statement, add:

```sql
    CREATE TABLE IF NOT EXISTS tutor_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_code TEXT NOT NULL,
      flashcard_id INTEGER REFERENCES flashcards(id) ON DELETE SET NULL,
      title TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tutor_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES tutor_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      followups TEXT,
      model TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tutor_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_code TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT,
      created_at TEXT
    );
```

`ON DELETE SET NULL` on `flashcard_id`: deleting a card in Manage must not erase the conversation
about it. `tutor_notes` deliberately has **no** UNIQUE constraint — unlike `notes`, which is
`UNIQUE(topic_code, reading_no)` and models curriculum readings.

- [ ] **Step 2: Export the client, `str` and `nowLocalISO`**

`client` (line ~25), `str` (line ~180) and `nowLocalISO` (line ~52) are module-private today, so
`tutor-db.ts` cannot reuse them. At the **end** of `src/lib/db.ts`, add:

```ts
// Exported for src/lib/tutor-db.ts, which owns the tutor queries so this file
// (already ~750 lines across cards, questions, notes and exams) does not grow further.
export { client, str, nowLocalISO };
```

`nowLocalISO` (not `todayISO`) is what the tutor tables need: `todayISO` is date-only, and a chat
archive ordered by `updated_at` must distinguish two chats on the same day.

- [ ] **Step 3: Verify the app still builds**

Run: `npm run lint && npm run build`
Expected: both pass. The tables themselves are created by `ensureInit()` at first request; you
verify them for real in Task 4 Step 5.

- [ ] **Step 4: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat(tutor): add tutor_sessions/messages/notes tables"
```

---

## Task 3: Tutor queries

**Files:**
- Create: `src/lib/tutor-db.ts`

- [ ] **Step 1: Write the module**

Create `src/lib/tutor-db.ts`:

```ts
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
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm run build`
Expected: build succeeds. If it complains that `client`/`str` are not exported, Task 2 Step 2 was skipped.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tutor-db.ts
git commit -m "feat(tutor): tutor queries (context, sessions, messages, notes)"
```

---

## Task 4: Streaming route handler

**Files:**
- Create: `src/app/api/tutor/route.ts`
- Modify: `src/app/actions.ts` (export `callClaude`)

- [ ] **Step 1: Re-read the Next.js streaming reference**

Run: `sed -n '395,445p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
Expected: shows `new ReadableStream({ async pull(controller) {...} })` returned via `new Response(stream)`.
This plan's handler uses that shape. If the installed docs disagree, follow the docs, not this plan.

- [ ] **Step 2: Export `callClaude` from actions.ts for reuse**

In `src/app/actions.ts`, change the declaration (currently `async function callClaude(`) to:

```ts
export async function callClaude(
```

Leave its body untouched — the tutor route uses it only for the non-streaming summariser.

- [ ] **Step 3: Write the route handler**

Create `src/app/api/tutor/route.ts`:

```ts
import { ensureInit } from "@/lib/db";
import {
  addMessage,
  createSession,
  getHistoryForClaude,
  getTutorContext,
} from "@/lib/tutor-db";
import { parseRelated, renderContextBlock, TUTOR_SYSTEM } from "@/lib/tutor";

const enc = new TextEncoder();
const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");

export async function POST(request: Request) {
  await ensureInit();

  const { cardId, message, sessionId } = (await request.json()) as {
    cardId: number;
    message: string;
    sessionId?: number;
  };

  if (!message?.trim()) {
    return Response.json({ error: "Empty question." }, { status: 400 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json(
      {
        error:
          "AI explanations aren’t set up yet. Add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) environment variable.",
      },
      { status: 503 },
    );
  }

  const ctx = await getTutorContext(cardId);
  if (!ctx) return Response.json({ error: "Card not found." }, { status: 404 });

  // Every turn carries the card + stats block. It is NOT enough to send it only
  // on the first turn: addMessage persists the raw `message`, not `userContent`,
  // so the rendered block never enters the stored history — the tutor would
  // forget the card from turn 2 onward, exactly when the student taps a chip.
  // ~150 tokens/turn against max_tokens 700 is the right trade.
  const sid = sessionId ?? (await createSession(ctx.topicCode, cardId, message));
  const history = sessionId ? await getHistoryForClaude(sid, 8) : [];
  const userContent = renderContextBlock(ctx, message);

  // Raw text, so the archive shows what the student actually typed.
  await addMessage(sid, "user", message);

  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(line({ t: "start", sessionId: sid }));

      let full = "";
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
            max_tokens: 700,
            stream: true,
            system: [
              { type: "text", text: TUTOR_SYSTEM, cache_control: { type: "ephemeral" } },
            ],
            messages: [
              ...history.map((m) => ({ role: m.role, content: m.content })),
              { role: "user", content: userContent },
            ],
          }),
        });

        if (!res.ok || !res.body) {
          const detail = (await res.text()).slice(0, 200);
          controller.enqueue(
            line({ t: "error", message: `Claude request failed (${res.status}). ${detail}` }),
          );
          controller.close();
          return;
        }

        // Anthropic streams SSE: lines of `data: {...}`. We only need text deltas.
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload) as {
                type?: string;
                delta?: { type?: string; text?: string };
              };
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                const text = evt.delta.text ?? "";
                full += text;
                controller.enqueue(line({ t: "delta", v: text }));
              }
            } catch {
              // ignore keep-alives / partial frames
            }
          }
        }

        // Persist only a cleanly finished answer, so the archive never holds
        // a truncated one.
        const { body, followups } = parseRelated(full);
        const messageId = await addMessage(sid, "assistant", body, followups, model);
        controller.enqueue(line({ t: "done", messageId, followups }));
      } catch (e) {
        controller.enqueue(
          line({ t: "error", message: "Could not reach Claude. " + String(e).slice(0, 150) }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
```

- [ ] **Step 4: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Smoke-test the stream by hand**

Start the dev server with a key (uses the local dev DB, not Turso):

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

In another terminal, find any card id and stream an answer:

```bash
curl -N -s -X POST http://localhost:3000/api/tutor \
  -H 'content-type: application/json' \
  -d '{"cardId":1,"message":"Explain this card simply."}'
```

Expected: a `{"t":"start",...}` line, many `{"t":"delta","v":"..."}` lines arriving progressively,
then one `{"t":"done","messageId":...,"followups":[...]}` line with 3 followups.

Without a key, expected instead: HTTP 503 and the "AI explanations aren’t set up yet" message.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/tutor/route.ts src/app/actions.ts
git commit -m "feat(tutor): streaming /api/tutor route handler"
```

---

## Task 5: Non-streaming server actions

**Files:**
- Modify: `src/app/actions.ts`

- [ ] **Step 1: Add the actions**

Append to `src/app/actions.ts`:

```ts
// ---------------------------------------------------------------- AI tutor
import {
  listSessions,
  getMessages,
  getMessageWithTopic,
  saveTutorNote,
  listTutorNotes,
  transcriptFor,
} from "@/lib/tutor-db";

export async function listTutorSessions(topicCode?: string | null) {
  await ensureInit();
  return listSessions(topicCode ?? null);
}

export async function getTutorSession(sessionId: number) {
  await ensureInit();
  return getMessages(sessionId, 100);
}

export async function saveAnswerAsNote(
  messageId: number,
): Promise<{ ok: boolean; error?: string }> {
  await ensureInit();
  const m = await getMessageWithTopic(messageId);
  if (!m || !m.content.trim()) return { ok: false, error: "Nothing to save." };
  await saveTutorNote(m.topic_code, m.title || "Tutor answer", m.content, "answer");
  return { ok: true };
}

const SUMMARY_SYSTEM = `You turn a CFA student's tutor conversations into one revision note.
Write a tight, exam-focused note in English: the key ideas, the formulas, and the mistakes the student kept making.
Use short bullets. Keep CFA terminology exact. Do not invent anything that is not in the transcript.
Start with a single-line title, then the note body. No preamble.`;

export async function summariseSessionsToNote(
  sessionIds: number[],
): Promise<{ ok: boolean; error?: string }> {
  await ensureInit();
  if (!sessionIds.length) return { ok: false, error: "Select at least one chat." };

  const { topicCode, text } = await transcriptFor(sessionIds);
  if (!text.trim()) return { ok: false, error: "Those chats are empty." };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      error:
        "AI explanations aren’t set up yet. Add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) environment variable.",
    };
  }
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  const r = await callClaude(key, model, text.slice(0, 12000), SUMMARY_SYSTEM, 900);
  if (!r.text) return { ok: false, error: r.error };

  const [firstLine, ...rest] = r.text.split("\n");
  await saveTutorNote(
    topicCode,
    firstLine.replace(/^#+\s*/, "").trim() || "Tutor summary",
    rest.join("\n").trim() || r.text,
    "summary",
  );
  return { ok: true };
}

export async function getTutorNotes(topicCode: string) {
  await ensureInit();
  return listTutorNotes(topicCode);
}
```

> Move the `import` block to the top of the file with the other imports — `actions.ts` keeps all
> imports together. It is shown inline here only so you can see what it needs.

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions.ts
git commit -m "feat(tutor): actions for archive, save-to-note and summarise"
```

---

## Task 6: Sidebar component

**Files:**
- Create: `src/components/TutorSidebar.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/TutorSidebar.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { saveAnswerAsNote } from "@/app/actions";
import { btnSecondary } from "@/components/ui";
import type { Flashcard } from "@/lib/types";

interface Msg {
  id?: number;
  role: "user" | "assistant";
  content: string;
  followups?: string[];
}

export function TutorSidebar({ card, onClose }: { card: Flashcard; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const sessionId = useRef<number | undefined>(undefined);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setBusy(true);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: card.id, message: q, sessionId: sessionId.current }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `Request failed (${res.status}).`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.trim()) continue;
          const evt = JSON.parse(p) as {
            t: string;
            v?: string;
            sessionId?: number;
            messageId?: number;
            followups?: string[];
            message?: string;
          };
          if (evt.t === "start") sessionId.current = evt.sessionId;
          if (evt.t === "delta")
            setMsgs((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                content: copy[copy.length - 1].content + (evt.v ?? ""),
              };
              return copy;
            });
          if (evt.t === "done")
            setMsgs((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                id: evt.messageId,
                followups: evt.followups ?? [],
              };
              return copy;
            });
          if (evt.t === "error") setError(evt.message ?? "Something went wrong.");
        }
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setInput(q); // keep the question so Retry is one click
    } finally {
      setBusy(false);
    }
  }

  async function save(messageId: number) {
    const r = await saveAnswerAsNote(messageId);
    if (r.ok) setSaved(messageId);
    else setError(r.error ?? "Could not save.");
  }

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-white sm:inset-y-0 sm:left-auto sm:right-0 sm:w-96 sm:border-l sm:border-slate-200 sm:shadow-xl">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">🤖 Ask the tutor</div>
          <div className="text-xs text-slate-500">{card.topic_code}</div>
        </div>
        <button onClick={onClose} className={btnSecondary} aria-label="Close tutor">
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {msgs.length === 0 && (
          <p className="text-sm text-slate-500">
            Ask anything about this card. The tutor can see your reps, ease and how often you
            missed it.
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i}>
            <div
              className={
                m.role === "user"
                  ? "ml-auto w-fit max-w-[85%] rounded-2xl bg-indigo-600 px-3 py-2 text-sm text-white"
                  : "whitespace-pre-wrap text-sm text-slate-700"
              }
            >
              {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
            </div>
            {m.role === "assistant" && m.id && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => save(m.id!)} className={btnSecondary}>
                  {saved === m.id ? "✓ Saved" : "💾 Save to note"}
                </button>
                {(m.followups ?? []).map((f) => (
                  <button
                    key={f}
                    onClick={() => ask(f)}
                    className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 border-t border-slate-200 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Why is this true?"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          disabled={busy || !input.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "…" : "Ask"}
        </button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 2: Mount it on the Flashcards page**

In `src/app/flashcards/page.tsx`:

Add the imports:

```tsx
import { useState } from "react"; // already imported — just ensure useState is there
import { TutorSidebar } from "@/components/TutorSidebar";
```

Add state next to the other `useState` calls in `FlashcardsPage`:

```tsx
const [tutorOpen, setTutorOpen] = useState(false);
```

Inside the card block, directly **after** the `{card.tags && (...)}` line, add the trigger:

```tsx
<button
  onClick={() => setTutorOpen(true)}
  className="mt-4 inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
>
  🤖 Ask about this card
</button>
```

At the end of the returned fragment, just before the closing `</>`, add:

```tsx
{tutorOpen && card && <TutorSidebar card={card} onClose={() => setTutorOpen(false)} />}
```

The sidebar never opens on its own — the review rhythm comes first.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both pass.

Run: `ANTHROPIC_API_KEY=sk-ant-... npm run dev`, open `/flashcards`, click "🤖 Ask about this card",
ask "Why do I keep missing this?".
Expected: text streams in; three chips appear when it finishes; clicking a chip asks the next
question in the same session; "Save to note" flips to "✓ Saved".

- [ ] **Step 4: Commit**

```bash
git add src/components/TutorSidebar.tsx src/app/flashcards/page.tsx
git commit -m "feat(tutor): sidebar with streaming answers and Related chips"
```

---

## Task 7: History + summarise

**Files:**
- Create: `src/components/TutorHistory.tsx`
- Modify: `src/components/TutorSidebar.tsx`

- [ ] **Step 1: Write the history panel**

Create `src/components/TutorHistory.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { getTutorSession, listTutorSessions, summariseSessionsToNote } from "@/app/actions";
import { btnSecondary } from "@/components/ui";

interface SessionRow {
  id: number;
  topic_code: string;
  title: string;
  updated_at: string;
  messages: number;
}
interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export function TutorHistory({ topicCode, onBack }: { topicCode: string; onBack: () => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [open, setOpen] = useState<Msg[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    listTutorSessions(topicCode).then(setRows).catch(() => setRows([]));
  }, [topicCode]);

  function toggle(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function summarise() {
    setStatus("Summarising…");
    const r = await summariseSessionsToNote(picked);
    setStatus(r.ok ? "✓ Saved to Notes" : (r.error ?? "Failed."));
  }

  if (open) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <button onClick={() => setOpen(null)} className={btnSecondary}>
          ← Back to history
        </button>
        <div className="mt-4 space-y-3">
          {open.map((m) => (
            <div key={m.id} className="text-sm">
              <div className="text-xs font-semibold text-slate-400">
                {m.role === "user" ? "You" : "Tutor"}
              </div>
              <div className="whitespace-pre-wrap text-slate-700">{m.content}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <button onClick={onBack} className={btnSecondary}>
        ← Back to chat
      </button>

      {rows === null ? (
        <div className="mt-4 h-24 animate-pulse rounded-lg bg-slate-200" />
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No past chats for {topicCode} yet.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((s) => (
            <li key={s.id} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2">
              <input
                type="checkbox"
                checked={picked.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-1"
                aria-label={`Select ${s.title}`}
              />
              <button
                onClick={() => getTutorSession(s.id).then(setOpen)}
                className="flex-1 text-left"
              >
                <div className="line-clamp-2 text-sm text-slate-800">{s.title}</div>
                <div className="text-xs text-slate-400">
                  {s.updated_at} · {s.messages} messages
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked.length > 0 && (
        <button onClick={summarise} className="mt-4 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white">
          📝 Summarise {picked.length} chat{picked.length > 1 ? "s" : ""} into a note
        </button>
      )}
      {status && <p className="mt-2 text-xs text-slate-600">{status}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add the History toggle to the sidebar**

In `src/components/TutorSidebar.tsx`:

Add the import:

```tsx
import { TutorHistory } from "@/components/TutorHistory";
```

Add state beside the others:

```tsx
const [showHistory, setShowHistory] = useState(false);
```

In `<header>`, put a History button before the close button:

```tsx
<div className="flex gap-2">
  <button onClick={() => setShowHistory((v) => !v)} className={btnSecondary}>
    {showHistory ? "💬 Chat" : "🕘 History"}
  </button>
  <button onClick={onClose} className={btnSecondary} aria-label="Close tutor">
    ✕
  </button>
</div>
```

(The close button currently sits directly in `<header>`; wrap both in this `div`.)

Then render the panel instead of the chat body when `showHistory` is true — wrap the existing
messages `<div>` and the `<form>`:

```tsx
{showHistory ? (
  <TutorHistory topicCode={card.topic_code} onBack={() => setShowHistory(false)} />
) : (
  <>
    {/* existing messages div and form go here, unchanged */}
  </>
)}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both pass.

Run the dev server, ask two separate questions (close and reopen the sidebar to start a second
session), open History, tick both, click Summarise.
Expected: "✓ Saved to Notes".

- [ ] **Step 4: Commit**

```bash
git add src/components/TutorHistory.tsx src/components/TutorSidebar.tsx
git commit -m "feat(tutor): chat archive with multi-select summarise-to-note"
```

---

## Task 8: Show tutor notes in Notes

**Files:**
- Modify: `src/app/notes/page.tsx`

- [ ] **Step 1: Read the page first**

Run: `sed -n '1,75p' src/app/notes/page.tsx`

Facts you need (verified): it is a `"use client"` page; it imports `browseNotes` from
`@/app/actions` and `type { Note } from "@/lib/db"`; `const [notes, setNotes] = useState<Note[] | null>(null)`
is at line ~13; a `load` `useCallback` at line ~59-68 calls `browseNotes(topic)` then `setNotes(n)`
and is keyed on `topic`.

- [ ] **Step 2: Fetch tutor notes in the same `load` callback**

Add `getTutorNotes` to the existing `@/app/actions` import:

```tsx
import { browseNotes, finishReading, getReadTodayKeys, getTutorNotes, notesOverview, searchNotes } from "@/app/actions";
```

Add state directly under the `notes` state (line ~13):

```tsx
const [tutorNotes, setTutorNotes] = useState<
  { id: number; title: string; body: string; source: string; created_at: string }[]
>([]);
```

Inside the `load` `useCallback` (line ~59), after the existing `browseNotes(...)` call and before
its closing brace, add:

```tsx
getTutorNotes(topic)
  .then(setTutorNotes)
  .catch(() => setTutorNotes([]));
```

`load` already depends on `topic`, so switching topics refreshes both lists.

Render below the curriculum notes list:

```tsx
{tutorNotes.length > 0 && (
  <section className="mt-8">
    <h3 className="mb-2 text-sm font-semibold text-slate-500">🤖 From the tutor</h3>
    <ul className="space-y-3">
      {tutorNotes.map((n) => (
        <li key={n.id} className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{n.title}</span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] uppercase text-indigo-600">
              {n.source}
            </span>
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{n.body}</div>
          <div className="mt-2 text-xs text-slate-400">{n.created_at}</div>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both pass.

Open `/notes`, pick the topic you saved a note under.
Expected: the tutor note appears under "🤖 From the tutor", tagged `answer` or `summary`.

- [ ] **Step 4: Commit**

```bash
git add src/app/notes/page.tsx
git commit -m "feat(tutor): surface tutor notes in the Notes page"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full check**

```bash
npm test && npm run lint && npm run build
```
Expected: `pass 6  fail 0`, no lint errors, build succeeds.

- [ ] **Step 2: Walk the whole feature once**

With `ANTHROPIC_API_KEY=sk-ant-... npm run dev`:

1. `/flashcards` → "🤖 Ask about this card" → ask → answer streams → 3 chips appear.
2. Tap a chip → it asks that question in the same session.
3. "Save to note" → `/notes` shows it under "🤖 From the tutor".
4. Sidebar → History → tick 2 chats → Summarise → note appears in `/notes`.
5. Stop the dev server mid-answer → the sidebar shows an error and the question stays in the
   input; the archive holds no truncated answer.

- [ ] **Step 3: Confirm the key is set in production**

The key already exists in Vercel per `docs`/RECOVERY-NOTES (`ANTHROPIC_API_KEY`). Confirm at
Vercel → Project → Settings → Environments before deploying, and optionally set
`ANTHROPIC_MODEL` to a stronger model for better tutoring.

- [ ] **Step 4: Push and open a PR**

```bash
git push -u origin feat/flashcard-ai-tutor
```

Then open a PR for review. **Do not push without the user's go-ahead.**
