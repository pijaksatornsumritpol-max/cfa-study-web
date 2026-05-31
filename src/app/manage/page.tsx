"use client";

import { useEffect, useRef, useState } from "react";
import {
  addCard,
  addQuiz,
  browseCards,
  browseQuestions,
  extractFileText,
  generateFromText,
  importCardsCsv,
  importQuestionsCsv,
  removeCard,
  removeQuestion,
  saveGenerated,
  seedSamples,
} from "@/app/actions";
import { btnPrimary, btnSecondary, PageTitle, TopicSelect } from "@/components/ui";
import { TOPIC_CODES } from "@/lib/topics";
import type { Flashcard, GenCard, GenQuestion, ImportResult, Question } from "@/lib/types";

type Tab = "generate" | "card" | "question" | "import" | "browse";

const TABS: { id: Tab; label: string }[] = [
  { id: "generate", label: "✨ Generate with AI" },
  { id: "card", label: "➕ Add flashcard" },
  { id: "question", label: "➕ Add question" },
  { id: "import", label: "📥 Import CSV" },
  { id: "browse", label: "🗂 Browse / delete" },
];

export default function ManagePage() {
  const [tab, setTab] = useState<Tab>("generate");
  return (
    <>
      <PageTitle>⚙️ Manage content</PageTitle>
      <div className="mb-5 flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "generate" && <Generate />}
      {tab === "card" && <AddCard />}
      {tab === "question" && <AddQuestion />}
      {tab === "import" && <ImportCsv />}
      {tab === "browse" && <Browse />}
    </>
  );
}

// ---------------------------------------------------------------- generate with AI
function Generate() {
  const [topic, setTopic] = useState("ETH");
  const [text, setText] = useState("");
  const [nCards, setNCards] = useState(8);
  const [nQuestions, setNQuestions] = useState(5);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cards, setCards] = useState<GenCard[]>([]);
  const [questions, setQuestions] = useState<GenQuestion[]>([]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(true);
    setMsg(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await extractFileText(dataUrl, file.name);
      if (res.error || !res.text) {
        setMsg({ ok: false, text: res.error || "No text found in the file." });
      } else {
        setText(res.text);
        const pageNote = res.pages ? `${res.pages} page(s), ` : "";
        const trunc = res.truncated ? " (truncated — upload a smaller section for the rest)" : "";
        setMsg({
          ok: true,
          text: `Loaded ${pageNote}${res.text.length.toLocaleString()} characters from ${file.name}.${trunc}`,
        });
      }
    } catch {
      setMsg({ ok: false, text: "Could not read that file." });
    } finally {
      setExtracting(false);
      e.target.value = "";
    }
  }

  async function generate() {
    setBusy(true);
    setMsg(null);
    setCards([]);
    setQuestions([]);
    try {
      const res = await generateFromText(topic, text, nCards, nQuestions);
      if (res.error) {
        setMsg({ ok: false, text: res.error });
      } else {
        setCards(res.flashcards);
        setQuestions(res.questions);
        setMsg({
          ok: true,
          text: `Generated ${res.flashcards.length} flashcards and ${res.questions.length} questions — review below, then save.`,
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      const r = await saveGenerated(topic, cards, questions);
      setMsg({ ok: true, text: `Saved ${r.cards} flashcards and ${r.questions} questions to ${topic}. ✅` });
      setCards([]);
      setQuestions([]);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  const total = cards.length + questions.length;

  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm text-slate-600">
          Upload a file (PDF, Excel, CSV) or paste study text, pick a topic, and AI turns it
          into flashcards and quiz questions. You review everything before it’s saved.
        </p>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Topic">
            <TopicSelect value={topic} onChange={setTopic} includeAll={false} />
          </Field>
          <Field label="# Flashcards">
            <input
              type="number"
              min={0}
              max={20}
              value={nCards}
              onChange={(e) => setNCards(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </Field>
          <Field label="# Questions">
            <input
              type="number"
              min={0}
              max={20}
              value={nQuestions}
              onChange={(e) => setNQuestions(Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
              className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </Field>
        </div>
        <Field label="Upload a file (PDF, Excel, CSV, or text)">
          <input
            type="file"
            accept=".pdf,.xlsx,.xls,.csv,.txt,.md"
            onChange={onFile}
            disabled={extracting || busy}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-700"
          />
          {extracting && <p className="mt-1 text-sm text-slate-500">⏳ Extracting text…</p>}
        </Field>
        <div className="text-center text-xs text-slate-400">— or paste text directly —</div>
        <Field label="Study text">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="Paste a chapter, section, or your notes here…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </Field>
        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={busy || extracting || !text.trim()} className={btnPrimary}>
            {busy ? "Generating…" : "✨ Generate"}
          </button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-amber-600"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </Card>

      {total > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-slate-900">Preview · {total} items</h3>
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className={btnPrimary}>
                {busy ? "Saving…" : `Save to ${topic}`}
              </button>
              <button
                onClick={() => {
                  setCards([]);
                  setQuestions([]);
                }}
                className={btnSecondary}
              >
                Discard
              </button>
            </div>
          </div>

          {cards.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Flashcards ({cards.length})
              </div>
              <div className="space-y-2">
                {cards.map((c, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <div className="font-medium text-slate-800">{c.front}</div>
                      <button
                        onClick={() => setCards(cards.filter((_, j) => j !== i))}
                        className="shrink-0 text-slate-400 hover:text-rose-600"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1 text-slate-600">{c.back}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {questions.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Questions ({questions.length})
              </div>
              <div className="space-y-2">
                {questions.map((q, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <div className="font-medium text-slate-800">{q.stem}</div>
                      <button
                        onClick={() => setQuestions(questions.filter((_, j) => j !== i))}
                        className="shrink-0 text-slate-400 hover:text-rose-600"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                    <ul className="mt-1 space-y-0.5 text-slate-600">
                      {(["A", "B", "C"] as const).map((L) => {
                        const txt = L === "A" ? q.choice_a : L === "B" ? q.choice_b : q.choice_c;
                        const ok = q.correct === L;
                        return (
                          <li key={L} className={ok ? "font-semibold text-emerald-700" : ""}>
                            {L}. {txt}
                            {ok ? " ✓" : ""}
                          </li>
                        );
                      })}
                    </ul>
                    {q.explanation && (
                      <div className="mt-1 text-xs text-slate-500">{q.explanation}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- add card
function AddCard() {
  const [topic, setTopic] = useState("ETH");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [tags, setTags] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      if (!front.trim() || !back.trim()) {
        setMsg({ ok: false, text: "Front and back are required." });
        return;
      }
      const { ok } = await addCard(topic, front, back, tags);
      if (ok) {
        setMsg({ ok: true, text: "Card added." });
        setFront("");
        setBack("");
        setTags("");
      } else {
        setMsg({ ok: false, text: "Could not add card." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Field label="Topic">
        <TopicSelect value={topic} onChange={setTopic} includeAll={false} />
      </Field>
      <Field label="Front (question / prompt)">
        <Textarea value={front} onChange={setFront} />
      </Field>
      <Field label="Back (answer)">
        <Textarea value={back} onChange={setBack} />
      </Field>
      <Field label="Tags (comma-separated, optional)">
        <Input value={tags} onChange={setTags} />
      </Field>
      <SubmitRow busy={busy} onClick={submit} label="Add card" msg={msg} />
    </Card>
  );
}

// ---------------------------------------------------------------- add question
function AddQuestion() {
  const [topic, setTopic] = useState("ETH");
  const [stem, setStem] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const [correct, setCorrect] = useState("A");
  const [expl, setExpl] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      if (![stem, a, b, c].every((x) => x.trim())) {
        setMsg({ ok: false, text: "Stem and all three choices are required." });
        return;
      }
      const { ok } = await addQuiz(topic, stem, a, b, c, correct, expl);
      if (ok) {
        setMsg({ ok: true, text: "Question added." });
        setStem("");
        setA("");
        setB("");
        setC("");
        setExpl("");
      } else {
        setMsg({ ok: false, text: "Could not add question." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Field label="Topic">
        <TopicSelect value={topic} onChange={setTopic} includeAll={false} />
      </Field>
      <Field label="Question stem">
        <Textarea value={stem} onChange={setStem} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Choice A">
          <Input value={a} onChange={setA} />
        </Field>
        <Field label="Choice B">
          <Input value={b} onChange={setB} />
        </Field>
        <Field label="Choice C">
          <Input value={c} onChange={setC} />
        </Field>
      </div>
      <Field label="Correct answer">
        <select
          value={correct}
          onChange={(e) => setCorrect(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          {["A", "B", "C"].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Explanation (optional)">
        <Textarea value={expl} onChange={setExpl} />
      </Field>
      <SubmitRow busy={busy} onClick={submit} label="Add question" msg={msg} />
    </Card>
  );
}

// ---------------------------------------------------------------- import csv
function ImportCsv() {
  return (
    <div className="space-y-6">
      <Card>
        <p className="text-sm text-slate-600">
          Bulk-load your own content. <strong>topic_code</strong> must be one of:{" "}
          <span className="font-mono text-xs">{TOPIC_CODES.join(", ")}</span>
        </p>
        <CsvUploader
          title="Flashcards CSV"
          columns="topic_code, front, back, tags"
          action={importCardsCsv}
        />
        <hr className="my-5 border-slate-200" />
        <CsvUploader
          title="Questions CSV"
          columns="topic_code, stem, choice_a, choice_b, choice_c, correct, explanation"
          action={importQuestionsCsv}
        />
        <hr className="my-5 border-slate-200" />
        <div>
          <p className="mb-2 text-sm text-slate-600">Need the format? Download a blank template:</p>
          <div className="flex flex-wrap gap-2">
            <button
              className={btnSecondary}
              onClick={() =>
                download(
                  "flashcards_template.csv",
                  "topic_code,front,back,tags\nETH,Your prompt here,Your answer here,memorize\n",
                )
              }
            >
              flashcards_template.csv
            </button>
            <button
              className={btnSecondary}
              onClick={() =>
                download(
                  "questions_template.csv",
                  "topic_code,stem,choice_a,choice_b,choice_c,correct,explanation\nQM,Your question here,Option A,Option B,Option C,B,Why B is right\n",
                )
              }
            >
              questions_template.csv
            </button>
          </div>
        </div>
      </Card>

      <SampleLoader />
    </div>
  );
}

function CsvUploader({
  title,
  columns,
  action,
}: {
  title: string;
  columns: string;
  action: (text: string) => Promise<ImportResult>;
}) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      setResult(await action(text));
    } catch {
      setResult({ added: 0, skipped: 0, error: "Could not read file." });
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div className="mt-2">
      <div className="text-sm font-medium text-slate-800">{title}</div>
      <div className="mb-2 text-xs text-slate-500">
        columns: <span className="font-mono">{columns}</span>
      </div>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        onChange={onFile}
        disabled={busy}
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-indigo-700"
      />
      {busy && <p className="mt-2 text-sm text-slate-500">Importing…</p>}
      {result &&
        (result.error ? (
          <p className="mt-2 text-sm text-rose-600">{result.error}</p>
        ) : (
          <p className="mt-2 text-sm text-emerald-700">
            Imported {result.added}. Skipped {result.skipped} (bad topic_code/empty).
          </p>
        ))}
    </div>
  );
}

function SampleLoader() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await seedSamples();
      setMsg(r.error ? r.error : `Loaded ${r.added} sample items. Refresh other tabs to see them.`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <div className="text-sm font-medium text-slate-800">Starter content</div>
      <p className="mb-3 mt-1 text-xs text-slate-500">
        Load ~20 example flashcards and ~10 questions (only works when the bank is empty)
        so you can see how everything works.
      </p>
      <button onClick={load} disabled={busy} className={btnSecondary}>
        {busy ? "Loading…" : "Load sample set"}
      </button>
      {msg && <p className="mt-2 text-sm text-slate-600">{msg}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- browse
function Browse() {
  const [view, setView] = useState<"cards" | "questions">("cards");
  const [topic, setTopic] = useState("ALL");
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);

  const code = topic === "ALL" ? null : topic;

  function reload() {
    if (view === "cards") {
      setCards(null);
      browseCards(code).then(setCards).catch(() => setCards([]));
    } else {
      setQuestions(null);
      browseQuestions(code).then(setQuestions).catch(() => setQuestions([]));
    }
  }

  useEffect(reload, [view, topic]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="flex gap-2">
          {(["cards", "questions"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                view === v
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {v === "cards" ? "Flashcards" : "Questions"}
            </button>
          ))}
        </div>
        <div className="w-full max-w-xs">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Filter by topic
          </label>
          <TopicSelect value={topic} onChange={setTopic} />
        </div>
      </div>

      {view === "cards" ? (
        cards === null ? (
          <Loading />
        ) : cards.length === 0 ? (
          <Empty>No flashcards.</Empty>
        ) : (
          <div className="space-y-2">
            {cards.map((c) => (
              <details key={c.id} className="rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-4 py-2.5 text-sm">
                  <span className="mr-2 font-mono text-xs text-indigo-600">
                    [{c.topic_code}]
                  </span>
                  {c.front.length > 70 ? c.front.slice(0, 70) + "…" : c.front}
                </summary>
                <div className="border-t border-slate-100 px-4 py-3 text-sm">
                  <div className="whitespace-pre-wrap text-slate-700">
                    <strong>Back:</strong> {c.back}
                  </div>
                  <div className="mt-2 text-xs text-slate-400">
                    reps {c.reps} · interval {c.interval}d · due {c.due_date ?? "—"}
                  </div>
                  <DeleteButton
                    onDelete={async () => {
                      await removeCard(c.id);
                      reload();
                    }}
                  />
                </div>
              </details>
            ))}
          </div>
        )
      ) : questions === null ? (
        <Loading />
      ) : questions.length === 0 ? (
        <Empty>No questions.</Empty>
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
            <details key={q.id} className="rounded-lg border border-slate-200 bg-white">
              <summary className="cursor-pointer px-4 py-2.5 text-sm">
                <span className="mr-2 font-mono text-xs text-indigo-600">
                  [{q.topic_code}]
                </span>
                {q.stem.length > 70 ? q.stem.slice(0, 70) + "…" : q.stem}
              </summary>
              <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-700">
                <div>A. {q.choice_a}</div>
                <div>B. {q.choice_b}</div>
                <div>C. {q.choice_c}</div>
                <div className="mt-1 font-medium">Correct: {q.correct}</div>
                {q.explanation && (
                  <div className="mt-1 text-xs text-slate-500">{q.explanation}</div>
                )}
                <DeleteButton
                  onDelete={async () => {
                    await removeQuestion(q.id);
                    reload();
                  }}
                />
              </div>
            </details>
          ))}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- small bits
function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  );
}

function Textarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  );
}

function SubmitRow({
  busy,
  onClick,
  label,
  msg,
}: {
  busy: boolean;
  onClick: () => void;
  label: string;
  msg: { ok: boolean; text: string } | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onClick} disabled={busy} className={btnPrimary}>
        {busy ? "Saving…" : label}
      </button>
      {msg && (
        <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-amber-600"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onDelete();
        } catch {
          setBusy(false);
        }
      }}
      className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}

function Loading() {
  return <div className="h-24 animate-pulse rounded-lg bg-slate-200" />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}
