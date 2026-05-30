import { NextResponse } from "next/server";
import { countsByTopic, ensureInit } from "@/lib/db";

// Lightweight health check: confirms the app can reach its database and reports
// which backend it's using. Never returns secrets. Handy for verifying the
// Vercel + Turso wiring after deploy: GET /api/health
export async function GET() {
  const usingTurso = Boolean(process.env.TURSO_DATABASE_URL);
  // Which AI provider is configured (never exposes the key itself).
  const ai = process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : process.env.GEMINI_API_KEY
      ? "gemini"
      : "none";
  try {
    await ensureInit();
    const stats = await countsByTopic();
    return NextResponse.json({
      ok: true,
      db: usingTurso ? "turso" : "local-file",
      ai,
      topics: stats.length,
      totalCards: stats.reduce((a, s) => a + s.cards, 0),
      totalQuestions: stats.reduce((a, s) => a + s.questions, 0),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: usingTurso ? "turso" : "local-file", error: String(e) },
      { status: 500 },
    );
  }
}
