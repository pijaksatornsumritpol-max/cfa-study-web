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
