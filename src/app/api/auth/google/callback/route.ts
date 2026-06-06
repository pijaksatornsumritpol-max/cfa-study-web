import { NextRequest, NextResponse } from "next/server";
import { exchangeCode } from "@/lib/google";
import { ensureInit, saveGoogleAuth } from "@/lib/db";

// Google redirects back here with ?code & ?state. Exchange for tokens and store them.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieState = req.cookies.get("g_state")?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(new URL("/plan?google=error", origin));
  }
  try {
    await ensureInit();
    const redirectUri = `${origin}/api/auth/google/callback`;
    const tok = await exchangeCode(code, redirectUri);
    await saveGoogleAuth(tok);
    const res = NextResponse.redirect(new URL("/plan?google=connected", origin));
    res.cookies.delete("g_state");
    return res;
  } catch {
    return NextResponse.redirect(new URL("/plan?google=error", origin));
  }
}
