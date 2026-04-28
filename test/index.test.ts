import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SELF, fetchMock } from "cloudflare:test";
import { sign, sendEvents, TEST_AXIOM_TOKEN } from "./helpers";
import type { Env } from "../src/types";
import worker from "../src/index";

describe("worker request handling", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  function mockAxiom(status = 200) {
    fetchMock
      .get("https://api.axiom.co")
      .intercept({ path: /\/v1\/datasets\//, method: "POST" })
      .reply(status, status === 200 ? "" : "Axiom error body");
  }

  it("rejects non-POST requests with 405", async () => {
    const response = await SELF.fetch("https://worker.test", {
      method: "GET",
    });
    expect(response.status).toBe(405);
    expect(await response.text()).toBe("Method not allowed");
  });

  it("returns 400 for invalid JSON body", async () => {
    const body = "not valid json";
    const signature = await sign(body);
    const response = await SELF.fetch("https://worker.test", {
      method: "POST",
      headers: { "x-vercel-signature": signature },
      body,
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid JSON body");
  });

  it("forwards transformed events to Axiom with correct auth headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    fetchMock
      .get("https://api.axiom.co")
      .intercept({
        path: /\/v1\/datasets\//,
        method: "POST",
        headers(headers: Record<string, string>) {
          capturedHeaders = headers;
          return true;
        },
      })
      .reply(200, "");

    const response = await sendEvents(SELF, [{ message: "test" }]);
    expect(response.status).toBe(200);
    expect(capturedHeaders["authorization"]).toBe(`Bearer ${TEST_AXIOM_TOKEN}`);
    expect(capturedHeaders["content-type"]).toBe("application/json");
  });

  it("rejects POST with valid JSON but missing signature header with 401", async () => {
    const response = await SELF.fetch("https://worker.test", {
      method: "POST",
      body: JSON.stringify([{ message: "test" }]),
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid signature");
  });

  it("returns 200 without calling Axiom when events transform to empty array", async () => {
    // sendEvents with [] produces "[]" which parses to an empty array — transformEvents returns []
    // fetchMock.disableNetConnect() will throw if any external fetch is attempted
    const response = await sendEvents(SELF, []);
    expect(response.status).toBe(200);
  });

  it("returns 502 when Axiom responds with an error", async () => {
    mockAxiom(500);
    const response = await sendEvents(SELF, [{ message: "test" }]);
    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Axiom error");
  });

  it("wraps a single object body in an array", async () => {
    mockAxiom();
    const body = JSON.stringify({ message: "single event" });
    const signature = await sign(body);
    const response = await SELF.fetch("https://worker.test", {
      method: "POST",
      headers: { "x-vercel-signature": signature },
      body,
    });
    expect(response.status).toBe(200);
  });
});

describe("error handling", () => {
  function callWorker(env: Partial<Env>, body = "{}") {
    return worker.fetch(
      new Request("https://worker.test", {
        method: "POST",
        body,
      }),
      env as Env,
    );
  }

  it("returns 500 when VERCEL_DRAIN_SECRET is missing", async () => {
    const response = await callWorker({
      AXIOM_API_TOKEN: "token",
      AXIOM_DATASET: "dataset",
      VERCEL_DRAIN_SECRET: "",
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal configuration error");
  });

  it("returns 500 when AXIOM_API_TOKEN is missing", async () => {
    const response = await callWorker({
      AXIOM_API_TOKEN: "",
      AXIOM_DATASET: "dataset",
      VERCEL_DRAIN_SECRET: "secret",
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal configuration error");
  });

  it("returns 500 when AXIOM_DATASET is missing", async () => {
    const response = await callWorker({
      AXIOM_API_TOKEN: "token",
      AXIOM_DATASET: "",
      VERCEL_DRAIN_SECRET: "secret",
    });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Internal configuration error");
  });

  describe("Axiom fetch errors", () => {
    beforeEach(() => {
      fetchMock.activate();
      fetchMock.disableNetConnect();
    });

    afterEach(() => {
      fetchMock.deactivate();
    });

    it("returns 502 on Axiom network error", async () => {
      fetchMock
        .get("https://api.axiom.co")
        .intercept({ path: /\/v1\/datasets\//, method: "POST" })
        .replyWithError(new TypeError("fetch failed"));

      const response = await sendEvents(SELF, [{ message: "test" }]);
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Upstream network error");
    });

    it("returns 504 on Axiom timeout", async () => {
      const err = new Error("The operation was aborted.");
      err.name = "TimeoutError";
      fetchMock
        .get("https://api.axiom.co")
        .intercept({ path: /\/v1\/datasets\//, method: "POST" })
        .replyWithError(err);

      const response = await sendEvents(SELF, [{ message: "test" }]);
      expect(response.status).toBe(504);
      expect(await response.text()).toBe("Upstream timeout");
    });

    it("returns 500 on unexpected error", async () => {
      const err = new Error("something broke");
      err.name = "SomeUnexpectedError";
      fetchMock
        .get("https://api.axiom.co")
        .intercept({ path: /\/v1\/datasets\//, method: "POST" })
        .replyWithError(err);

      const response = await sendEvents(SELF, [{ message: "test" }]);
      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Internal server error");
    });
  });
});
