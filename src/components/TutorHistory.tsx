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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listTutorSessions(topicCode).then(setRows).catch(() => setRows([]));
  }, [topicCode]);

  function toggle(id: number) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function summarise() {
    if (saving) return;
    setSaving(true);
    setStatus("Summarising…");
    const r = await summariseSessionsToNote(picked);
    setStatus(r.ok ? "✓ Saved to Notes" : (r.error ?? "Failed."));
    if (r.ok) setPicked([]);
    setSaving(false);
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
                onClick={() => getTutorSession(s.id).then(setOpen).catch(() => setStatus("Couldn’t open that chat."))}
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
        <button onClick={summarise} disabled={saving} className="mt-4 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          📝 Summarise {picked.length} chat{picked.length > 1 ? "s" : ""} into a note
        </button>
      )}
      {status && <p className="mt-2 text-xs text-slate-600">{status}</p>}
    </div>
  );
}
