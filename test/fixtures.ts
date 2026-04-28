import type { VercelEvent, TransformedEvent } from "../src/types";

// ---------------------------------------------------------------------------
// Input fixtures — representative event shapes covering each classification
// path the transform pipeline can take. Identifiers (project, host, IDs) are
// synthetic placeholders — replace as needed when adapting this template.
// ---------------------------------------------------------------------------

/** Type 1 — Pino JSON: structured log from application code */
export const PINO_JSON_EVENT: VercelEvent = {
  id: "57294023630177160681535497100000",
  message: JSON.stringify({
    level: 30,
    time: 1771606815354,
    msg: "Request completed",
    event: "api.request.completed",
    userId: "user_2vYCnWBOef0JiGNGlSKJkFn8IbZ",
    durationMs: 467,
    status: 200,
  }),
  timestamp: 1771606815354,
  type: "stdout",
  level: "info",
  branch: "main",
  invocationId: "inv-1",
  requestId: "req-pino-1",
  source: "lambda",
  proxy: {
    clientIp: "73.162.43.97",
    host: "example.com",
    lambdaRegion: "iad1",
    method: "POST",
    path: "/api/chat/sessions/abc/messages",
    pathType: "api",
    region: "iad1",
    scheme: "https",
    timestamp: 1771606814886,
    userAgent: ["Mozilla/5.0", "(Macintosh; Intel Mac OS X 10_15_7)"],
    vercelCache: "MISS",
  },
  deploymentId: "dpl-pino-1",
  host: "my-app-abc.vercel.app",
  environment: "production",
  projectId: "prj-my-app",
  projectName: "my-app",
  executionRegion: "iad1",
  path: "/api/chat/sessions/[sessionId]/messages",
};

/** Type 2 — Consolidated lambda: warm start (no Init Duration) */
export const CONSOLIDATED_EVENT: VercelEvent = {
  id: "57294023630177160681535497200000",
  message:
    "START RequestId: ae86ab0a-1234-5678-9abc-def012345678\n" +
    "[GET] /api/cron/workflows/cleanup-stuck status=200\n" +
    "END RequestId: ae86ab0a-1234-5678-9abc-def012345678\n" +
    "REPORT RequestId: ae86ab0a-1234-5678-9abc-def012345678\tDuration: 5192.67 ms\tBilled Duration: 5193 ms\tMemory Size: 2048 MB\tMax Memory Used: 345 MB",
  timestamp: 1771605767814,
  type: "stdout",
  level: "info",
  branch: "main",
  invocationId: "inv-2",
  requestId: "req-consolidated-1",
  statusCode: 200,
  source: "lambda",
  proxy: {
    clientIp: "3.236.243.173",
    host: "example.com",
    lambdaRegion: "iad1",
    method: "GET",
    path: "/api/cron/workflows/cleanup-stuck",
    pathType: "api",
    region: "iad1",
    scheme: "https",
    statusCode: 200,
    timestamp: 1771605762621,
    userAgent: ["vercel-cron/1.0"],
    vercelCache: "MISS",
  },
  deploymentId: "dpl-consolidated-1",
  host: "my-app-xyz.vercel.app",
  environment: "production",
  projectId: "prj-my-app",
  projectName: "my-app",
  executionRegion: "iad1",
  path: "/api/cron/workflows/cleanup-stuck",
};

/** Type 2 — Consolidated lambda: cold start (with Init Duration) */
export const CONSOLIDATED_COLD_START_EVENT: VercelEvent = {
  id: "57294023630177160681535497300000",
  message:
    "START RequestId: e2be6152-aaaa-bbbb-cccc-ddddeeee0000\n" +
    "[GET] /api/legal/agreements status=200\n" +
    "END RequestId: e2be6152-aaaa-bbbb-cccc-ddddeeee0000\n" +
    "REPORT RequestId: e2be6152-aaaa-bbbb-cccc-ddddeeee0000\tDuration: 7142.31 ms\tBilled Duration: 7143 ms\tMemory Size: 2048 MB\tMax Memory Used: 365 MB\tInit Duration: 1891.45 ms",
  timestamp: 1771605800000,
  type: "stdout",
  level: "info",
  branch: "main",
  invocationId: "inv-3",
  requestId: "req-cold-1",
  statusCode: 200,
  source: "lambda",
  proxy: {
    clientIp: "73.162.43.97",
    host: "example.com",
    lambdaRegion: "iad1",
    method: "GET",
    path: "/api/legal/agreements",
    pathType: "api",
    region: "iad1",
    scheme: "https",
    statusCode: 200,
    timestamp: 1771605792857,
    userAgent: ["Mozilla/5.0", "(Macintosh; Intel Mac OS X 10_15_7)"],
    vercelCache: "MISS",
  },
  deploymentId: "dpl-cold-1",
  host: "my-app-cold.vercel.app",
  environment: "production",
  projectId: "prj-my-app",
  projectName: "my-app",
  executionRegion: "iad1",
  path: "/api/legal/agreements",
};

/** Type 3 — Plain text: non-JSON, non-consolidated message */
export const PLAIN_TEXT_EVENT: VercelEvent = {
  id: "43749662070177160576781441600000",
  message: "Pool release event triggered outside of request scope.",
  timestamp: 1771605767814,
  type: "stdout",
  level: "info",
  branch: "main",
  invocationId: "inv-4",
  requestId: "req-plain-1",
  source: "lambda",
  proxy: {
    clientIp: "3.236.243.173",
    host: "example.com",
    lambdaRegion: "iad1",
    method: "GET",
    path: "/api/cron/workflows/cleanup-stuck",
    pathType: "api",
    region: "iad1",
    scheme: "https",
    timestamp: 1771605762621,
    userAgent: ["vercel-cron/1.0"],
    vercelCache: "MISS",
  },
  deploymentId: "dpl-plain-1",
  host: "my-app-plain.vercel.app",
  environment: "production",
  projectId: "prj-my-app",
  projectName: "my-app",
  executionRegion: "iad1",
  path: "/api/cron/workflows/cleanup-stuck",
};

// ---------------------------------------------------------------------------
// Expected output fixtures
// ---------------------------------------------------------------------------

/** Type 1 → Pino JSON output: app.* namespace, message = Pino msg */
export const EXPECTED_PINO_OUTPUT: TransformedEvent = {
  _time: "2026-02-20T17:00:15.354Z",
  level: "info",
  message: "Request completed",
  app: {
    event: "api.request.completed",
    userId: "user_2vYCnWBOef0JiGNGlSKJkFn8IbZ",
    durationMs: 467,
    status: 200,
  },
  request: {
    id: "req-pino-1",
    ip: "73.162.43.97",
    host: "example.com",
    method: "POST",
    path: "/api/chat/sessions/abc/messages",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    vercelCache: "MISS",
    scheme: "https",
  },
  vercel: {
    deploymentId: "dpl-pino-1",
    deploymentURL: "my-app-abc.vercel.app",
    environment: "production",
    projectId: "prj-my-app",
    projectName: "my-app",
    region: "iad1",
    route: "/api/chat/sessions/[sessionId]/messages",
    source: "lambda",
  },
};

/** Type 2 → Consolidated log sub-event */
export const EXPECTED_CONSOLIDATED_LOG_OUTPUT: TransformedEvent = {
  _time: "2026-02-20T16:42:47.814Z",
  level: "info",
  message: "[GET] /api/cron/workflows/cleanup-stuck status=200",
  request: {
    id: "req-consolidated-1",
    ip: "3.236.243.173",
    host: "example.com",
    method: "GET",
    path: "/api/cron/workflows/cleanup-stuck",
    statusCode: 200,
    userAgent: "vercel-cron/1.0",
    vercelCache: "MISS",
    scheme: "https",
  },
  vercel: {
    deploymentId: "dpl-consolidated-1",
    deploymentURL: "my-app-xyz.vercel.app",
    environment: "production",
    projectId: "prj-my-app",
    projectName: "my-app",
    region: "iad1",
    route: "/api/cron/workflows/cleanup-stuck",
    source: "lambda-log",
  },
};

/** Type 2 → Consolidated report sub-event (warm start) */
export const EXPECTED_CONSOLIDATED_REPORT_OUTPUT: TransformedEvent = {
  _time: "2026-02-20T16:42:47.814Z",
  level: "info",
  request: {
    id: "req-consolidated-1",
    ip: "3.236.243.173",
    host: "example.com",
    method: "GET",
    path: "/api/cron/workflows/cleanup-stuck",
    statusCode: 200,
    userAgent: "vercel-cron/1.0",
    vercelCache: "MISS",
    scheme: "https",
  },
  report: {
    durationMs: 5192.67,
    maxMemoryUsedMb: 345,
  },
  vercel: {
    deploymentId: "dpl-consolidated-1",
    deploymentURL: "my-app-xyz.vercel.app",
    environment: "production",
    projectId: "prj-my-app",
    projectName: "my-app",
    region: "iad1",
    route: "/api/cron/workflows/cleanup-stuck",
    source: "lambda",
  },
};

/** Type 2 → Cold start report sub-event (with initDurationMs) */
export const EXPECTED_COLD_START_REPORT_OUTPUT: TransformedEvent = {
  _time: "2026-02-20T16:43:20.000Z",
  level: "info",
  request: {
    id: "req-cold-1",
    ip: "73.162.43.97",
    host: "example.com",
    method: "GET",
    path: "/api/legal/agreements",
    statusCode: 200,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    vercelCache: "MISS",
    scheme: "https",
  },
  report: {
    durationMs: 7142.31,
    maxMemoryUsedMb: 365,
    initDurationMs: 1891.45,
  },
  vercel: {
    deploymentId: "dpl-cold-1",
    deploymentURL: "my-app-cold.vercel.app",
    environment: "production",
    projectId: "prj-my-app",
    projectName: "my-app",
    region: "iad1",
    route: "/api/legal/agreements",
    source: "lambda",
  },
};

/** Type 3 → Plain text output: message preserved as-is */
export const EXPECTED_PLAIN_TEXT_OUTPUT: TransformedEvent = {
  _time: "2026-02-20T16:42:47.814Z",
  level: "info",
  message: "Pool release event triggered outside of request scope.",
  request: {
    id: "req-plain-1",
    ip: "3.236.243.173",
    host: "example.com",
    method: "GET",
    path: "/api/cron/workflows/cleanup-stuck",
    userAgent: "vercel-cron/1.0",
    vercelCache: "MISS",
    scheme: "https",
  },
  vercel: {
    deploymentId: "dpl-plain-1",
    deploymentURL: "my-app-plain.vercel.app",
    environment: "production",
    projectId: "prj-my-app",
    projectName: "my-app",
    region: "iad1",
    route: "/api/cron/workflows/cleanup-stuck",
    source: "lambda",
  },
};
