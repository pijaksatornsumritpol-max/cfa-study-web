// Non-streaming Claude Messages call (server-only). Lives here rather than in
// actions.ts because that file is `"use server"`, where every export becomes a
// publicly callable RPC endpoint — this takes an API key as its first argument
// and must never be reachable from the browser. The streaming tutor path in
// app/api/tutor/route.ts builds its own fetch and does not use this.
import "server-only";

export async function callClaude(
  key: string,
  model: string,
  userContent: string,
  system: string,
  maxTokens: number,
): Promise<{ text?: string; error?: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userContent }],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      return { error: `Claude request failed (${res.status}). ${detail}` };
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
    };
    const text = data.content
      ?.filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (!text) return { error: "Claude returned an empty response — try again." };
    return { text };
  } catch (e) {
    return { error: "Could not reach Claude. " + String(e).slice(0, 150) };
  }
}
