import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, googleConfigured } from "@/lib/google";

// Kick off Google OAuth: redirect the user to Google's consent screen.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/plan?google=notconfigured", origin));
  }
  const redirectUri = `${origin}/api/auth/google/callback`;
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(buildAuthUrl(redirectUri, state));
  res.cookies.set("g_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
