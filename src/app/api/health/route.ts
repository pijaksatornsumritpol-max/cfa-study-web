import { NextRequest, NextResponse } from "next/server";
import { generateFromText } from "@/app/actions";
import { countsByTopic, ensureInit } from "@/lib/db";

// Lightweight health check: confirms the app can reach its database and reports
// which backend / AI provider is configured. Never returns secrets.
export async function GET(req: NextRequest) {
  const usingTurso = Boolean(process.env.TURSO_DATABASE_URL);
  const ai = process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : process.env.GEMINI_API_KEY
      ? "gemini"
      : "none";
  try {
    await ensureInit();
    const stats = await countsByTopic();

    // TEMP: one-off end-to-end test of the live AI generation pipeline (?gen=1).
    if (req.nextUrl.searchParams.get("gen") === "1") {
      const g = await generateFromText(
        "QM",
        "Future value of a single sum with annual compounding is FV = PV*(1+r)^n; present value is PV = FV/(1+r)^n. These are core time-value-of-money relationships in CFA quantitative methods.",
        2,
        1,
      );
      return NextResponse.json({
        ok: true,
        ai,
        gen: {
          cards: g.flashcards.length,
          questions: g.questions.length,
          error: g.error ?? null,
          sampleFront: g.flashcards[0]?.front ?? null,
        },
      });
    }

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
