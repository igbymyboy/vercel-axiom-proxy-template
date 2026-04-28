import { describe, it, expect } from "vitest";
import {
  parseConsolidatedMessage,
  mapEnvelope,
  expandEvent,
  mapToOutput,
  transformEvents,
} from "../src/transform";
import {
  PINO_JSON_EVENT,
  CONSOLIDATED_EVENT,
  CONSOLIDATED_COLD_START_EVENT,
  PLAIN_TEXT_EVENT,
  EXPECTED_PINO_OUTPUT,
  EXPECTED_CONSOLIDATED_LOG_OUTPUT,
  EXPECTED_CONSOLIDATED_REPORT_OUTPUT,
  EXPECTED_COLD_START_REPORT_OUTPUT,
  EXPECTED_PLAIN_TEXT_OUTPUT,
} from "./fixtures";

// ---------------------------------------------------------------------------
// parseConsolidatedMessage
// ---------------------------------------------------------------------------

describe("parseConsolidatedMessage", () => {
  it("extracts log line and report from warm start", () => {
    const result = parseConsolidatedMessage(CONSOLIDATED_EVENT.message!);
    expect(result.logMessage).toBe(
      "[GET] /api/cron/workflows/cleanup-stuck status=200",
    );
    expect(result.report).toEqual({
      durationMs: 5192.67,
      maxMemoryUsedMb: 345,
      initDurationMs: undefined,
    });
  });

  it("parses Init Duration for cold starts", () => {
    const result = parseConsolidatedMessage(
      CONSOLIDATED_COLD_START_EVENT.message!,
    );
    expect(result.report!.initDurationMs).toBe(1891.45);
  });

  it("handles fractional durations", () => {
    const msg =
      "START RequestId: abc\nlog\nEND RequestId: abc\n" +
      "REPORT RequestId: abc\tDuration: 0.75 ms\tMemory Size: 128 MB\tMax Memory Used: 50 MB";
    const result = parseConsolidatedMessage(msg);
    expect(result.report!.durationMs).toBe(0.75);
  });

  it("drops START and END lines", () => {
    const msg =
      "START RequestId: abc\nthe log line\nEND RequestId: abc\n" +
      "REPORT RequestId: abc\tDuration: 10 ms\tMemory Size: 128 MB\tMax Memory Used: 50 MB";
    const result = parseConsolidatedMessage(msg);
    expect(result.logMessage).toBe("the log line");
  });
});

// ---------------------------------------------------------------------------
// expandEvent
// ---------------------------------------------------------------------------

describe("expandEvent", () => {
  it("classifies and returns 1 event for Pino JSON with parsedMessage", () => {
    const results = expandEvent(PINO_JSON_EVENT);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("pino-json");
    expect(results[0].parsedMessage).toBeDefined();
    expect(results[0].parsedMessage!.event).toBe("api.request.completed");
  });

  it("classifies and returns 1 event for plain text", () => {
    const results = expandEvent(PLAIN_TEXT_EVENT);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("plain-text");
    expect(results[0].parsedMessage).toBeUndefined();
  });

  it("classifies and returns 2 events for consolidated (log-line + report)", () => {
    const results = expandEvent(CONSOLIDATED_EVENT);
    expect(results).toHaveLength(2);
    expect(results[0].subType).toBe("log-line");
    expect(results[0].logMessage).toBe(
      "[GET] /api/cron/workflows/cleanup-stuck status=200",
    );
    expect(results[1].subType).toBe("report");
    expect(results[1].parsedReport!.durationMs).toBe(5192.67);
  });

  it("does not misclassify JSON array as Pino", () => {
    const results = expandEvent({ message: "[1,2,3]" });
    expect(results[0].type).toBe("plain-text");
  });

  it("does not misclassify JSON primitive as Pino", () => {
    expect(expandEvent({ message: '"hello"' })[0].type).toBe("plain-text");
    expect(expandEvent({ message: "123" })[0].type).toBe("plain-text");
    expect(expandEvent({ message: "true" })[0].type).toBe("plain-text");
  });

  it("handles invalid JSON starting with { as plain-text", () => {
    const results = expandEvent({ message: "{not valid json}" });
    expect(results[0].type).toBe("plain-text");
  });

  it("handles missing message as plain-text", () => {
    const results = expandEvent({});
    expect(results[0].type).toBe("plain-text");
  });

  it("returns empty array when consolidated has no log line or report", () => {
    const event = {
      ...CONSOLIDATED_EVENT,
      message: "START RequestId: abc\nEND RequestId: abc",
    };
    expect(expandEvent(event)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// mapEnvelope
// ---------------------------------------------------------------------------

describe("mapEnvelope", () => {
  it("maps proxy fields to request.* namespace", () => {
    const result = mapEnvelope(PINO_JSON_EVENT);
    expect(result.request).toEqual({
      id: "req-pino-1",
      ip: "73.162.43.97",
      host: "example.com",
      method: "POST",
      path: "/api/chat/sessions/abc/messages",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      vercelCache: "MISS",
      scheme: "https",
    });
  });

  it("maps deployment fields to vercel.* namespace", () => {
    const result = mapEnvelope(PINO_JSON_EVENT);
    expect(result.vercel).toEqual({
      deploymentId: "dpl-pino-1",
      deploymentURL: "my-app-abc.vercel.app",
      environment: "production",
      projectId: "prj-my-app",
      projectName: "my-app",
      region: "iad1",
      route: "/api/chat/sessions/[sessionId]/messages",
      source: "lambda",
    });
  });

  it("joins userAgent array to string", () => {
    const result = mapEnvelope(PINO_JSON_EVENT);
    expect(result.request!.userAgent).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    );
  });

  it("coalesces statusCode from proxy or top-level", () => {
    const result = mapEnvelope(CONSOLIDATED_EVENT);
    expect(result.request!.statusCode).toBe(200);
  });

  it("falls back to top-level statusCode when proxy has none", () => {
    const event = { statusCode: 500, requestId: "req-1" };
    const result = mapEnvelope(event);
    expect(result.request!.statusCode).toBe(500);
  });

  it("generates ISO 8601 _time from timestamp", () => {
    const result = mapEnvelope(PINO_JSON_EVENT);
    expect(result._time).toBe("2026-02-20T17:00:15.354Z");
  });

  it("drops unmapped fields", () => {
    const event = {
      message: "test",
      timestamp: 1000000000000,
      id: "should-be-dropped",
      type: "stdout",
      branch: "main",
      invocationId: "inv-x",
    };
    const result = mapEnvelope(event);
    expect((result as Record<string, unknown>).id).toBeUndefined();
    expect((result as Record<string, unknown>).type).toBeUndefined();
    expect((result as Record<string, unknown>).branch).toBeUndefined();
    expect((result as Record<string, unknown>).invocationId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapToOutput
// ---------------------------------------------------------------------------

describe("mapToOutput", () => {
  it("produces app.* with message=msg for Pino JSON", () => {
    const [classified] = expandEvent(PINO_JSON_EVENT);
    const result = mapToOutput(classified);
    expect(result.message).toBe("Request completed");
    expect(result.app).toBeDefined();
    expect(result.app!.event).toBe("api.request.completed");
    expect(result.app!.userId).toBe("user_2vYCnWBOef0JiGNGlSKJkFn8IbZ");
    // level and time should NOT be in app.*
    expect(result.app!.level).toBeUndefined();
    expect(result.app!.time).toBeUndefined();
  });

  it("promotes Pino numeric level to string", () => {
    const [classified] = expandEvent(PINO_JSON_EVENT);
    const result = mapToOutput(classified);
    expect(result.level).toBe("info"); // Pino 30 → "info"
  });

  it("falls back to string for non-standard Pino levels", () => {
    const event = {
      ...PINO_JSON_EVENT,
      message: JSON.stringify({ level: 35, msg: "custom" }),
    };
    const [classified] = expandEvent(event);
    const result = mapToOutput(classified);
    expect(result.level).toBe("35");
  });

  it("produces message + lambda-log source for consolidated log", () => {
    const classified = expandEvent(CONSOLIDATED_EVENT);
    const logEvent = classified.find((c) => c.subType === "log-line")!;
    const result = mapToOutput(logEvent);
    expect(result.message).toBe(
      "[GET] /api/cron/workflows/cleanup-stuck status=200",
    );
    expect(result.vercel!.source).toBe("lambda-log");
  });

  it("produces report.* + lambda source for consolidated report", () => {
    const classified = expandEvent(CONSOLIDATED_EVENT);
    const reportEvent = classified.find((c) => c.subType === "report")!;
    const result = mapToOutput(reportEvent);
    expect(result.report!.durationMs).toBe(5192.67);
    expect(result.report!.maxMemoryUsedMb).toBe(345);
    expect(result.message).toBeUndefined();
    expect(result.vercel!.source).toBe("lambda");
  });

  it("includes initDurationMs for cold start", () => {
    const classified = expandEvent(CONSOLIDATED_COLD_START_EVENT);
    const reportEvent = classified.find((c) => c.subType === "report")!;
    const result = mapToOutput(reportEvent);
    expect(result.report!.initDurationMs).toBe(1891.45);
  });

  it("preserves message for plain text", () => {
    const [classified] = expandEvent(PLAIN_TEXT_EVENT);
    const result = mapToOutput(classified);
    expect(result.message).toBe(
      "Pool release event triggered outside of request scope.",
    );
    expect(result.app).toBeUndefined();
    expect(result.report).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// transformEvents -- full pipeline
// ---------------------------------------------------------------------------

describe("transformEvents -- full pipeline", () => {
  it("transforms Pino JSON event to expected output", () => {
    const [result] = transformEvents([PINO_JSON_EVENT]);
    expect(result).toEqual(EXPECTED_PINO_OUTPUT);
  });

  it("transforms consolidated warm start to log + report", () => {
    const results = transformEvents([CONSOLIDATED_EVENT]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(EXPECTED_CONSOLIDATED_LOG_OUTPUT);
    expect(results[1]).toEqual(EXPECTED_CONSOLIDATED_REPORT_OUTPUT);
  });

  it("transforms consolidated cold start with initDurationMs", () => {
    const results = transformEvents([CONSOLIDATED_COLD_START_EVENT]);
    expect(results).toHaveLength(2);
    const reportEvent = results.find((e) => e.report !== undefined)!;
    expect(reportEvent).toEqual(EXPECTED_COLD_START_REPORT_OUTPUT);
  });

  it("transforms plain text event to expected output", () => {
    const [result] = transformEvents([PLAIN_TEXT_EVENT]);
    expect(result).toEqual(EXPECTED_PLAIN_TEXT_OUTPUT);
  });

  it("handles mixed batch of all 3 types", () => {
    const results = transformEvents([
      PINO_JSON_EVENT,
      CONSOLIDATED_EVENT,
      PLAIN_TEXT_EVENT,
    ]);
    // Pino → 1, Consolidated → 2, Plain text → 1
    expect(results).toHaveLength(4);
    expect(results[0]).toEqual(EXPECTED_PINO_OUTPUT);
    expect(results[1]).toEqual(EXPECTED_CONSOLIDATED_LOG_OUTPUT);
    expect(results[2]).toEqual(EXPECTED_CONSOLIDATED_REPORT_OUTPUT);
    expect(results[3]).toEqual(EXPECTED_PLAIN_TEXT_OUTPUT);
  });
});
