"use client";

import { useCallback, useEffect, useState } from "react";
import { browseNotes, notesOverview } from "@/app/actions";
import { PageTitle, TopicSelect } from "@/components/ui";
import { CODE_TO_NAME, TOPIC_CODES } from "@/lib/topics";
import type { Note } from "@/lib/db";

export default function NotesPage() {
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [topic, setTopic] = useState<string>("");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  // Load the per-topic counts once, then default to the first topic that has notes.
  useEffect(() => {
    notesOverview()
      .then((o) => {
        setOverview(o);
        const first = TOPIC_CODES.find((c) => (o[c] ?? 0) > 0) ?? TOPIC_CODES[0];
        setTopic((t) => t || first);
      })
      .catch(() => setOverview({}));
  }, []);

  const load = useCallback(() => {
    if (!topic) return;
    setNotes(null);
    setOpenId(null);
    browseNotes(topic)
      .then((n) => {
        setNotes(n);
        if (n.length) setOpenId(n[0].id); // open the first reading by default
      })
      .catch(() => setNotes([]));
  }, [topic]);

  useEffect(() => {
    load();
  }, [load]);

  const totalNotes = overview
    ? Object.values(overview).reduce((a, b) => a + b, 0)
    : null;

  return (
    <>
      <PageTitle>📖 Summary Notes — read & review</PageTitle>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Topic
          </label>
          <TopicSelect value={topic || "AI"} onChange={setTopic} includeAll={false} />
        </div>
        {totalNotes !== null && (
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
            {totalNotes} readings across all topics
          </span>
        )}
      </div>

      {topic && (
        <div className="mb-4 text-sm text-slate-500">
          {topic} — {CODE_TO_NAME[topic]}
          {overview && overview[topic] != null && (
            <span className="ml-2 text-slate-400">
              · {overview[topic] ?? 0} readings
            </span>
          )}
        </div>
      )}

      {notes === null ? (
        <div className="h-56 animate-pulse rounded-xl bg-slate-200" />
      ) : notes.length === 0 ? (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-6 text-sm text-slate-700">
          ยังไม่มีสรุปสำหรับวิชานี้ — Notes for this topic haven&apos;t been added yet.
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <div
              key={n.id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <button
                onClick={() => setOpenId((id) => (id === n.id ? null : n.id))}
                className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50"
              >
                <span className="flex items-center gap-3">
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-indigo-50 px-1.5 text-xs font-bold text-indigo-700">
                    R{n.reading_no}
                  </span>
                  <span className="font-semibold text-slate-900">{n.title}</span>
                </span>
                <span className="text-slate-400">{openId === n.id ? "−" : "+"}</span>
              </button>
              {openId === n.id && (
                <div className="border-t border-slate-100 px-5 py-4">
                  <NoteBody body={n.body} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ markdown */
/** Minimal, dependency-free renderer for the note bodies. Supports:
 *  "## "/"### " headings, "- " bullets, "> " formula callouts, blank-line
 *  paragraphs, and inline **bold** and `code`. */
function NoteBody({ body }: { body: string }) {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let bullets: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push(
        <p key={blocks.length} className="my-2 leading-relaxed text-slate-700">
          {inline(para.join(" "))}
        </p>,
      );
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={blocks.length} className="my-2 ml-5 list-disc space-y-1 text-slate-700">
          {bullets.map((b, i) => (
            <li key={i} className="leading-relaxed">
              {inline(b)}
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushBullets();
      flushPara();
    } else if (line.startsWith("### ")) {
      flushBullets();
      flushPara();
      blocks.push(
        <h4 key={blocks.length} className="mt-4 mb-1 text-sm font-bold text-slate-800">
          {inline(line.slice(4))}
        </h4>,
      );
    } else if (line.startsWith("## ")) {
      flushBullets();
      flushPara();
      blocks.push(
        <h3 key={blocks.length} className="mt-4 mb-1 text-base font-bold text-slate-900">
          {inline(line.slice(3))}
        </h3>,
      );
    } else if (line.startsWith("> ")) {
      flushBullets();
      flushPara();
      blocks.push(
        <div
          key={blocks.length}
          className="my-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 font-mono text-[13px] text-indigo-900"
        >
          {inline(line.slice(2))}
        </div>,
      );
    } else if (line.startsWith("- ")) {
      flushPara();
      bullets.push(line.slice(2));
    } else {
      flushBullets();
      para.push(line.trim());
    }
  }
  flushBullets();
  flushPara();

  return <div className="text-sm">{blocks}</div>;
}

/** Inline parser for **bold** and `code` spans. */
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Split on **bold** or `code`, keeping the delimiters via capture groups.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  parts.forEach((p, i) => {
    if (!p) return;
    if (p.startsWith("**") && p.endsWith("**")) {
      out.push(
        <strong key={i} className="font-semibold text-slate-900">
          {p.slice(2, -2)}
        </strong>,
      );
    } else if (p.startsWith("`") && p.endsWith("`")) {
      out.push(
        <code
          key={i}
          className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[13px] text-slate-800"
        >
          {p.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(p);
    }
  });
  return out;
}
