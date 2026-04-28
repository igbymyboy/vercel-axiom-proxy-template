import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { sign, TEST_SECRET } from "./helpers";
import { verifySignature } from "../src/verify";

// --- Integration tests (Phase 1 — via worker) ---

describe("signature verification (integration)", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  function mockAxiom() {
    fetchMock
      .get("https://api.axiom.co")
      .intercept({ path: /\/v1\/datasets\//, method: "POST" })
      .reply(200, "");
  }

  it("returns 401 for invalid signature", async () => {
    const body = JSON.stringify([{ message: "hello" }]);
    const response = await SELF.fetch("https://worker.test", {
      method: "POST",
      headers: { "x-vercel-signature": "invalid-signature" },
      body,
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid signature");
  });

  it("accepts valid signature and returns 200", async () => {
    mockAxiom();
    const body = JSON.stringify([{ message: "hello" }]);
    const signature = await sign(body);
    const response = await SELF.fetch("https://worker.test", {
      method: "POST",
      headers: { "x-vercel-signature": signature },
      body,
    });
    expect(response.status).toBe(200);
  });
});

// --- Unit tests (Phase 2 — direct function calls) ---

function encode(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

describe("verifySignature", () => {
  it("returns true for a valid signature", async () => {
    const body = '{"test":"data"}';
    const signature = await sign(body);
    const result = await verifySignature(encode(body), signature, TEST_SECRET);
    expect(result).toBe(true);
  });

  it("returns false for an invalid signature", async () => {
    const body = '{"test":"data"}';
    const result = await verifySignature(
      encode(body),
      "bad-signature",
      TEST_SECRET,
    );
    expect(result).toBe(false);
  });

  it("returns false when body has been tampered with", async () => {
    const body = '{"test":"data"}';
    const signature = await sign(body);
    const result = await verifySignature(
      encode('{"test":"tampered"}'),
      signature,
      TEST_SECRET,
    );
    expect(result).toBe(false);
  });

  it("handles empty body", async () => {
    const body = "";
    const signature = await sign(body);
    const result = await verifySignature(encode(body), signature, TEST_SECRET);
    expect(result).toBe(true);
  });
});
