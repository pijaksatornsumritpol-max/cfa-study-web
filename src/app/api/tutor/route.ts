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
