export const TEST_SECRET = "test-secret";
export const TEST_AXIOM_TOKEN = "test-axiom-token";

export async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_SECRET),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendEvents(
  SELF: Fetcher,
  events: unknown[],
): Promise<Response> {
  const body = JSON.stringify(events);
  const signature = await sign(body);
  return SELF.fetch("https://worker.test", {
    method: "POST",
    headers: { "x-vercel-signature": signature },
    body,
  });
}
