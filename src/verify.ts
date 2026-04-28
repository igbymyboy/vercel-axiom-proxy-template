let cachedKey: { secret: string; key: CryptoKey } | null = null;

async function getKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  cachedKey = { secret, key };
  return key;
}

export async function verifySignature(
  body: ArrayBuffer,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await getKey(secret);
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, body),
  );

  // Decode hex signature to bytes
  if (signature.length !== expected.byteLength * 2) return false;
  const incoming = new Uint8Array(expected.byteLength);
  for (let i = 0; i < incoming.byteLength; i++) {
    const byte = parseInt(signature.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return false;
    incoming[i] = byte;
  }

  return crypto.subtle.timingSafeEqual(expected, incoming);
}
