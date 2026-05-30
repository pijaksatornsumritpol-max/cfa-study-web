// 2026 CFA Level 1 topic weights (same as 2025). Client-safe: pure data only,
// no server imports — used both for DB seeding and for UI labels/dropdowns.

export interface TopicDef {
  code: string;
  name: string;
  low: number; // official weight range, low %
  high: number; // official weight range, high %
}

export const TOPICS: TopicDef[] = [
  { code: "ETH", name: "Ethical & Professional Standards", low: 15, high: 20 },
  { code: "QM", name: "Quantitative Methods", low: 6, high: 9 },
  { code: "ECO", name: "Economics", low: 6, high: 9 },
  { code: "FSA", name: "Financial Statement Analysis", low: 11, high: 14 },
  { code: "CI", name: "Corporate Issuers", low: 6, high: 9 },
  { code: "EI", name: "Equity Investments", low: 11, high: 14 },
  { code: "FI", name: "Fixed Income", low: 11, high: 14 },
  { code: "DER", name: "Derivatives", low: 5, high: 8 },
  { code: "AI", name: "Alternative Investments", low: 7, high: 10 },
  { code: "PM", name: "Portfolio Management", low: 8, high: 12 },
];

export const TOPIC_CODES = TOPICS.map((t) => t.code);

export const CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  TOPICS.map((t) => [t.code, t.name]),
);

export function topicLabel(code: string): string {
  return `${code} — ${CODE_TO_NAME[code] ?? code}`;
}
