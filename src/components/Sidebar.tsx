"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getSidebarCounts } from "@/app/actions";
import ThemeToggle from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Today", icon: "🗓️" },
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/flashcards", label: "Flashcards", icon: "🃏" },
  { href: "/quiz", label: "Quiz", icon: "📝" },
  { href: "/manage", label: "Manage", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<{ due: number; questions: number } | null>(null);

  // Refresh the live counts whenever the route changes (e.g. after a review or import).
  useEffect(() => {
    let active = true;
    getSidebarCounts()
      .then((c) => active && setCounts(c))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const links = NAV.map((n) => (
    <Link
      key={n.href}
      href={n.href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        isActive(n.href)
          ? "bg-indigo-50 text-indigo-700"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <span className="text-base">{n.icon}</span>
      {n.label}
    </Link>
  ));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:shrink-0 md:flex-col md:gap-1 border-r border-slate-200 bg-white p-4">
        <div className="mb-4 px-2">
          <div className="text-lg font-bold tracking-tight">📘 CFA L1 Study</div>
          <div className="text-xs text-slate-500">
            Daily habit · spaced repetition · quiz
          </div>
        </div>
        <nav className="flex flex-col gap-1">{links}</nav>
        <div className="mt-auto space-y-2 pt-4">
          <Metric label="Cards due today" value={counts?.due} accent="indigo" />
          <Metric label="Questions in bank" value={counts?.questions} accent="slate" />
          <div className="pt-2">
            <ThemeToggle className="w-full justify-center" />
          </div>
          <p className="px-1 pt-1 text-[11px] leading-snug text-slate-400">
            Tip: paste or upload your content in Manage → Generate with AI.
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="font-bold">📘 CFA L1</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              Due <span className="font-semibold text-indigo-600">{counts?.due ?? "—"}</span>
            </span>
            <ThemeToggle />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2">{links}</nav>
      </header>
    </>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | undefined;
  accent: "indigo" | "slate";
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`text-2xl font-bold ${
          accent === "indigo" ? "text-indigo-600" : "text-slate-800"
        }`}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}
