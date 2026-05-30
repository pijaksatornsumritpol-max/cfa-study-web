"use client";

import { TOPICS, topicLabel } from "@/lib/topics";

/** Topic filter dropdown. Value is a topic code, or "ALL" for no filter. */
export function TopicSelect({
  value,
  onChange,
  includeAll = true,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  includeAll?: boolean;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
    >
      {includeAll && <option value="ALL">All topics</option>}
      {TOPICS.map((t) => (
        <option key={t.code} value={t.code}>
          {topicLabel(t.code)}
        </option>
      ))}
    </select>
  );
}

/** A small section heading. */
export function PageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">
      {children}
    </h1>
  );
}

/** Primary button styling helper. */
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";

export const btnSecondary =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
