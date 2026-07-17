import { ensureInit } from "@/lib/db";
import {
  addMessage,
  createSession,
  getHistoryForClaude,
  getSession,
  getTutorContext,
} from "@/lib/tutor-db";
import { parseRelated, renderContextBlock, TUTOR_SYSTEM } from "@/lib/tutor";

const enc = new TextEncoder();
const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");

export async function POST(request: Request) {
  await ensureInit();

  // A malformed body throws SyntaxError, which would escape POST as a 500.
  let parsed: { cardId?: number; message?: string; sessionId?: number };
  try {
    parsed = await request.json();
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }
  const { cardId, message, sessionId } = parsed;

  if (!message?.trim()) {
    return Response.json({ error: "Empty question." }, { status: 400 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // Only ANTHROPIC_API_KEY: this route streams, and has no Gemini fallback
    // (different API). Naming GEMINI_API_KEY here would tell a Gemini-only user
    // to add the key they already have.
    return Response.json(
      {
        error:
          "AI explanations aren’t set up yet. Add an ANTHROPIC_API_KEY environment variable.",
      },
      { status: 503 },
    );
  }

  if (!Number.isInteger(cardId)) {
    return Response.json({ error: "Card not found." }, { status: 404 });
  }

  const ctx = await getTutorContext(cardId as number);
  if (!ctx) return Response.json({ error: "Card not found." }, { status: 404 });

  // The client latches sessionId from the `start` frame and replays it forever,
  // so a deleted session or a reset DB leaves it holding a stale id. Writing
  // against that id is a FOREIGN KEY failure (a 500) — check first and 404.
  // Not a security boundary: single-user app, no auth.
  if (sessionId !== undefined) {
    const existing = await getSession(sessionId);
    if (!existing || existing.topicCode !== ctx.topicCode) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }
  }

  // Every turn carries the card + stats block. It is NOT enough to send it only
  // on the first turn: addMessage persists the raw `message`, not `userContent`,
  // so the rendered block never enters the stored history — the tutor would
  // forget the card from turn 2 onward, exactly when the student taps a chip.
  // ~150 tokens/turn against max_tokens 700 is the right trade.
  const sid = sessionId ?? (await createSession(ctx.topicCode, cardId as number, message));
  const history = sessionId ? await getHistoryForClaude(sid, 8) : [];
  const userContent = renderContextBlock(ctx, message);

  // Raw text, so the archive shows what the student actually typed.
  await addMessage(sid, "user", message);

  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

  const stream = new ReadableStream({
    async start(controller) {
      // LOAD-BEARING, not defensive — do not simplify this away.
      // When the student closes the tab, Next 16.2.6 cancels this stream (verified
      // in dev AND a production build: `cancel() reason=ResponseAborted`). Every
      // enqueue after that throws ERR_INVALID_STATE — including the one in the
      // catch below, which throws a second time and escapes start() as an
      // unhandled rejection on every disconnect. Latch once, then no-op, so the
      // read loop still drains and the archive gets the complete answer.
      let alive = true;
      const send = (o: unknown) => {
        if (!alive) return;
        try {
          controller.enqueue(line(o));
        } catch {
          alive = false;
        }
      };

      send({ t: "start", sessionId: sid });

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
          send({ t: "error", message: `Claude request failed (${res.status}). ${detail}` });
          // No close() here: the `finally` below owns the single close. Closing
          // twice throws "Controller is already closed" out of start().
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
                error?: { type?: string; message?: string };
              };
              // Anthropic can end a stream with `event: error` (e.g. overloaded_error)
              // after emitting deltas. Ignoring it would let the loop finish normally
              // and persist the truncated text as if it were a complete answer.
              // Return instead: the archive keeps nothing, `finally` still closes once.
              if (evt.type === "error") {
                send({
                  t: "error",
                  message: `Claude stream error: ${evt.error?.message ?? "unknown"}`,
                });
                return;
              }
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                const text = evt.delta.text ?? "";
                full += text;
                send({ t: "delta", v: text });
              }
            } catch {
              // ignore keep-alives / partial frames
            }
          }
        }

        // Persist only a cleanly finished answer, so the archive never holds
        // a truncated one. This still runs when the client has gone away: the
        // upstream read loop drains to completion, so `full` is the whole answer,
        // and the archive gets it. A turn that dies mid-read persists nothing and
        // leaves an unpaired trailing `user`, which toValidHistory absorbs.
        const { body, followups } = parseRelated(full);

        // Its own catch: a DB failure here is NOT a Claude failure. The outer
        // catch would blame the network and leak libsql internals to the client.
        try {
          const messageId = await addMessage(sid, "assistant", body, followups, model);
          send({ t: "done", messageId, followups });
        } catch (e) {
          console.error("[tutor] failed to persist assistant message", e);
          send({
            t: "error",
            message: "Answer complete, but it couldn’t be saved to your history.",
          });
        }
      } catch (e) {
        send({ t: "error", message: "Could not reach Claude. " + String(e).slice(0, 150) });
      } finally {
        // Sole owner of close(). Guarded: closing an already-closed or errored
        // controller (client gone) throws.
        try {
          controller.close();
        } catch {
          // already closed / cancelled — nothing to do
        }
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
