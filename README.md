# Vercel → Axiom Log Proxy

A Cloudflare Worker that sits between Vercel's [custom log drain](https://vercel.com/docs/observability/log-drains) and Axiom's ingest API. It classifies incoming log messages by type, splits consolidated lambda output into individual events, restructures fields into clean namespaces (`request.*`, `vercel.*`, `app.*`, `report.*`), and forwards the result to Axiom — so you can query structured fields directly without runtime parsing.

```
Vercel Log Drain  ──POST──▶  Cloudflare Worker  ──POST──▶  Axiom Ingest API
                              ┌─────────────────┐
                              │ 1. Method check │
                              │ 2. HMAC verify  │
                              │ 3. Parse JSON   │
                              │ 4. Transform    │
                              │ 5. Forward      │
                              └─────────────────┘
```

**Contents:** [Using this as a template](#using-this-as-a-template) · [Local development](#local-development) · [Deployment](#deployment) · [Architecture](#architecture) · [Incoming event shape](#incoming-event-shape) · [Event classification](#event-classification) · [Transformation pipeline](#transformation-pipeline) · [Output examples](#output-examples) · [Field mapping reference](#field-mapping-reference)

---

## Using this as a template

This repo is a working Cloudflare Worker that you can fork and point at your own Vercel project + Axiom dataset.

1. **Fork or clone**, then `pnpm install`.
2. **Provision Axiom** — create (or pick) a dataset and generate an API token with ingest permissions.
3. **Provision Cloudflare** — make sure the account has a Workers-eligible domain for the route you'll use.
4. **Edit `wrangler.toml`**:
   - Set `AXIOM_DATASET` to your dataset name.
   - Set `routes.pattern` to your custom domain (e.g. `logs.example.com`).
5. **Set up the Vercel log drain** — in your Vercel project: Settings → Log Drains → *Custom Endpoint*, point it at the URL from step 4. Vercel returns a signing secret; keep it for step 6.
6. **Set secrets**:

   ```bash
   wrangler secret put AXIOM_API_TOKEN
   wrangler secret put VERCEL_DRAIN_SECRET
   ```

   For local dev, copy `.dev.vars.example` to `.dev.vars` and fill in the same values.
7. **Deploy** with `pnpm ship`.
8. **Verify** — trigger a request to your Vercel app, then query the dataset in Axiom.

The transform pipeline is opinionated: it expects the Vercel envelope, Pino-style JSON, and AWS Lambda `REPORT` lines, and emits the `request.*` / `vercel.*` / `app.*` / `report.*` namespaces. If your logs don't match those shapes, fork `src/transform.ts` and adjust the classifiers and field mappings.

---

## Local development

```bash
pnpm install
pnpm dev
```

This starts a local Wrangler dev server.

## Deployment

```bash
pnpm ship
```

### Configuration

Set in `wrangler.toml`:

| Variable         | Description                           |
| ---------------- | ------------------------------------- |
| `AXIOM_DATASET`  | Target Axiom dataset name             |
| `routes.pattern` | Custom domain for the Worker endpoint |

### Secrets

Set via `wrangler secret put <NAME>`:

| Secret                | Description                                            |
| --------------------- | ------------------------------------------------------ |
| `AXIOM_API_TOKEN`     | Axiom API token with ingest permissions                |
| `VERCEL_DRAIN_SECRET` | Signing secret from the Vercel log drain configuration |

---

## Architecture

### Request lifecycle

The worker entrypoint (`src/index.ts`) handles the full request lifecycle:

1. **Method check** — only POST is accepted (405 otherwise)
2. **Signature verification** (`src/verify.ts`) — HMAC-SHA1 of the raw request body, compared against the `x-vercel-signature` header using a timing-safe comparison
3. **JSON parse** — the body is parsed as a JSON array (or a single object, which is wrapped in an array)
4. **Transform** (`src/transform.ts`) — the pipeline classifies, expands, and remaps each event
5. **Forward** (`src/axiom.ts`) — the transformed array is POSTed to `https://api.axiom.co/v1/datasets/{dataset}/ingest`

If the transform produces zero events (e.g. a consolidated message with only START/END lines), the worker returns 200 without calling Axiom.

### Incoming event shape

Vercel delivers log drain events as a JSON array. Each event has an **envelope** of metadata fields and a `message` string containing the actual log output:

```jsonc
[
  {
    // ── Envelope fields ──
    "id": "57294023630177160681535497100000",
    "timestamp": 1771606815354,
    "type": "stdout",
    "level": "info",
    "branch": "main",
    "invocationId": "inv-1",
    "requestId": "req-pino-1",
    "statusCode": 200,
    "source": "lambda",
    "deploymentId": "dpl-pino-1",
    "host": "my-app-abc.vercel.app",
    "environment": "production",
    "projectId": "prj-my-app",
    "projectName": "my-app",
    "executionRegion": "iad1",
    "path": "/api/chat/sessions/[sessionId]/messages",

    "proxy": {
      "clientIp": "73.162.43.97",
      "host": "example.com",
      "method": "POST",
      "path": "/api/chat/sessions/abc/messages",
      "scheme": "https",
      "statusCode": 200,
      "userAgent": ["Mozilla/5.0", "(Macintosh; Intel Mac OS X 10_15_7)"],
      "vercelCache": "MISS",
      "region": "iad1",
      "lambdaRegion": "iad1"
    },

    // ── The message — content varies by type (see Event Classification) ──
    "message": "{\"level\":30,\"time\":1771606815354,\"msg\":\"Request completed\",\"event\":\"api.request.completed\"}"
  }
]
```

The `message` field is where the interesting variation happens — its content determines how the event is classified and transformed.

### Event classification

The worker inspects `message` and classifies each event into one of three types:

```
                          ┌──────────────────┐
                          │  event.message   │
                          └────────┬─────────┘
                                   │
              ┌────────────────────┼─────────────────────┐
              ▼                    ▼                     ▼
         Starts with           Starts with           Everything
      "START RequestId:"     "{" + parses as            else
       + contains "\n"        a JSON object
              │                    │                     │
              ▼                    ▼                     ▼
      ┌──────────────┐     ┌──────────────┐      ┌──────────────┐
      │ consolidated │     │  pino-json   │      │  plain-text  │
      │   (1 → 2)    │     │   (1 → 1)    │      │   (1 → 1)    │
      └──────────────┘     └──────────────┘      └──────────────┘
```

#### 1. Pino JSON (`pino-json`)

Message is a stringified JSON object — typically structured log output from [Pino](https://github.com/pinojs/pino).

```
{"level":30,"time":1771606815354,"msg":"Request completed","event":"api.request.completed","userId":"user_abc","durationMs":467}
```

The JSON is parsed and its fields are promoted into the output:
- `msg` → top-level `message`
- `level` (numeric) → top-level `level` (mapped: 10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)
- All remaining fields → `app.*` namespace

**Expansion:** 1 input event → 1 output event

#### 2. Consolidated Lambda (`consolidated`)

Vercel's custom endpoint drains deliver the entire stdout of a lambda invocation as a single message with embedded newlines:

```
START RequestId: ae86ab0a-1234-5678-9abc-def012345678
[GET] /api/cron/workflows/cleanup-stuck status=200
END RequestId: ae86ab0a-1234-5678-9abc-def012345678
REPORT RequestId: ae86ab0a-1234-5678-9abc-def012345678	Duration: 5192.67 ms	Billed Duration: 5193 ms	Memory Size: 2048 MB	Max Memory Used: 345 MB
```

The worker splits this into **two separate events**:

| Sub-event    | What it contains                                        |
| ------------ | ------------------------------------------------------- |
| **log-line** | The actual application output line (everything that isn't START/END/REPORT). Sets `vercel.source` to `"lambda-log"`. |
| **report**   | Parsed execution metrics: `report.durationMs`, `report.maxMemoryUsedMb`, and optionally `report.initDurationMs` (present on cold starts). No `message` field. |

START and END lines are dropped entirely.

**Expansion:** 1 input event → 2 output events

#### 3. Plain Text (`plain-text`)

Any message that doesn't match the above patterns — passed through as-is in the `message` field.

```
Pool release event triggered outside of request scope.
```

**Expansion:** 1 input event → 1 output event

### Transformation pipeline

Each incoming Vercel event flows through two stages:

```
VercelEvent[]
     │
     ▼
 expandEvent()          Classify + split each event
     │                  ┌─ pino-json    → 1 ClassifiedEvent
     │                  ├─ consolidated → 2 ClassifiedEvents (log + report)
     │                  └─ plain-text   → 1 ClassifiedEvent
     ▼
ClassifiedEvent[]
     │
     ▼
 mapToOutput()          Build output schema per classified event
     │                  ├─ mapEnvelope()  → request.* + vercel.* from envelope
     │                  └─ type-specific  → message, app.*, report.*
     ▼
TransformedEvent[]
```

The public entry point is `transformEvents()`, which is just:

```ts
events.flatMap(expandEvent).map(mapToOutput)
```

`mapEnvelope()` handles the common field remapping that applies to all event types — pulling fields from the Vercel envelope and `proxy` object into the `request.*` and `vercel.*` namespaces. Then each type applies its own logic on top:

| Type           | Additional output                                |
| -------------- | ------------------------------------------------ |
| `pino-json`    | `message` from `msg`, `level` from numeric level, remaining fields → `app.*` |
| `consolidated` (log-line) | `message` from the extracted log line, `vercel.source` set to `"lambda-log"` |
| `consolidated` (report)   | `report.*` with parsed metrics, no `message`  |
| `plain-text`   | `message` preserved as-is from raw event         |

### Output examples

#### Pino JSON → output

A structured log event from application code. The Pino JSON fields are parsed out of `message` and organized into the `app.*` namespace, while `msg` and `level` are promoted to the top level:

```json
{
  "_time": "2026-02-20T17:00:15.354Z",
  "level": "info",
  "message": "Request completed",
  "app": {
    "event": "api.request.completed",
    "userId": "user_2vYCnWBOef0JiGNGlSKJkFn8IbZ",
    "durationMs": 467,
    "status": 200
  },
  "request": {
    "id": "req-pino-1",
    "ip": "73.162.43.97",
    "host": "example.com",
    "method": "POST",
    "path": "/api/chat/sessions/abc/messages",
    "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    "vercelCache": "MISS",
    "scheme": "https"
  },
  "vercel": {
    "deploymentId": "dpl-pino-1",
    "deploymentURL": "my-app-abc.vercel.app",
    "environment": "production",
    "projectId": "prj-my-app",
    "projectName": "my-app",
    "region": "iad1",
    "route": "/api/chat/sessions/[sessionId]/messages",
    "source": "lambda"
  }
}
```

#### Consolidated → log-line output

The application log line extracted from the consolidated lambda output. Note `vercel.source` is changed to `"lambda-log"` to distinguish it from the original consolidated event:

```json
{
  "_time": "2026-02-20T16:42:47.814Z",
  "level": "info",
  "message": "[GET] /api/cron/workflows/cleanup-stuck status=200",
  "request": {
    "id": "req-consolidated-1",
    "ip": "3.236.243.173",
    "host": "example.com",
    "method": "GET",
    "path": "/api/cron/workflows/cleanup-stuck",
    "statusCode": 200,
    "userAgent": "vercel-cron/1.0",
    "vercelCache": "MISS",
    "scheme": "https"
  },
  "vercel": {
    "deploymentId": "dpl-consolidated-1",
    "deploymentURL": "my-app-xyz.vercel.app",
    "environment": "production",
    "projectId": "prj-my-app",
    "projectName": "my-app",
    "region": "iad1",
    "route": "/api/cron/workflows/cleanup-stuck",
    "source": "lambda-log"
  }
}
```

#### Consolidated → report output

The parsed Lambda execution metrics from the REPORT line. No `message` field — just the `report.*` namespace with duration, memory usage, and cold start init time (when applicable):

```jsonc
{
  "_time": "2026-02-20T16:42:47.814Z",
  "level": "info",
  // no "message" field for report events
  "request": {
    "id": "req-consolidated-1",
    "ip": "3.236.243.173",
    "host": "example.com",
    "method": "GET",
    "path": "/api/cron/workflows/cleanup-stuck",
    "statusCode": 200,
    "userAgent": "vercel-cron/1.0",
    "vercelCache": "MISS",
    "scheme": "https"
  },
  "report": {
    "durationMs": 5192.67,
    "maxMemoryUsedMb": 345
    // "initDurationMs": 1891.45  ← present on cold starts only
  },
  "vercel": {
    "deploymentId": "dpl-consolidated-1",
    "deploymentURL": "my-app-xyz.vercel.app",
    "environment": "production",
    "projectId": "prj-my-app",
    "projectName": "my-app",
    "region": "iad1",
    "route": "/api/cron/workflows/cleanup-stuck",
    "source": "lambda"
  }
}
```

#### Plain text → output

An unstructured log message, passed through as-is:

```json
{
  "_time": "2026-02-20T16:42:47.814Z",
  "level": "info",
  "message": "Pool release event triggered outside of request scope.",
  "request": {
    "id": "req-plain-1",
    "ip": "3.236.243.173",
    "host": "example.com",
    "method": "GET",
    "path": "/api/cron/workflows/cleanup-stuck",
    "userAgent": "vercel-cron/1.0",
    "vercelCache": "MISS",
    "scheme": "https"
  },
  "vercel": {
    "deploymentId": "dpl-plain-1",
    "deploymentURL": "my-app-plain.vercel.app",
    "environment": "production",
    "projectId": "prj-my-app",
    "projectName": "my-app",
    "region": "iad1",
    "route": "/api/cron/workflows/cleanup-stuck",
    "source": "lambda"
  }
}
```

### Field mapping reference

`mapEnvelope()` remaps fields from the Vercel envelope into the output namespaces. Fields not listed here are dropped.

| Vercel field                       | Output field           | Notes                          |
| ---------------------------------- | ---------------------- | ------------------------------ |
| `timestamp`                        | `_time`                | Converted to ISO 8601          |
| `level`                            | `level`                | May be overridden by Pino      |
| `requestId`                        | `request.id`           |                                |
| `proxy.clientIp`                   | `request.ip`           |                                |
| `proxy.host`                       | `request.host`         |                                |
| `proxy.method`                     | `request.method`       |                                |
| `proxy.path`                       | `request.path`         |                                |
| `proxy.statusCode` / `statusCode`  | `request.statusCode`   | Proxy value preferred          |
| `proxy.userAgent`                  | `request.userAgent`    | Array joined with space        |
| `proxy.vercelCache`                | `request.vercelCache`  |                                |
| `proxy.scheme`                     | `request.scheme`       |                                |
| `proxy.referer`                    | `request.referer`      |                                |
| `proxy.cacheId`                    | `request.cacheId`      |                                |
| `deploymentId`                     | `vercel.deploymentId`  |                                |
| `host`                             | `vercel.deploymentURL` |                                |
| `environment`                      | `vercel.environment`   |                                |
| `projectId`                        | `vercel.projectId`     |                                |
| `projectName`                      | `vercel.projectName`   |                                |
| `executionRegion`                  | `vercel.region`        |                                |
| `path`                             | `vercel.route`         |                                |
| `source`                           | `vercel.source`        | Overridden to `"lambda-log"` for consolidated log-line events |

**Dropped fields:** `id`, `type`, `branch`, `invocationId`, `proxy.lambdaRegion`, `proxy.pathType`, `proxy.pathTypeVariant`, `proxy.region`, `proxy.timestamp`

### Known limitations

**No buffering on Axiom outage.** The worker forwards events to Axiom synchronously — if Axiom returns an error or times out, the worker returns a 5xx to Vercel. Vercel's log drain retry behavior is not well-documented; for webhooks, Vercel retries up to 5 times over ~6 hours, but it's unclear whether log drains share this policy. After retries are exhausted, events are permanently lost — Vercel provides no dead letter queue or replay mechanism. In practice this means a sustained Axiom outage (longer than Vercel's retry window) will result in missing log data.

### Testing

Vitest with `@cloudflare/vitest-pool-workers`. Run with:

```bash
pnpm test
```

| File                      | Coverage                                               |
| ------------------------- | ------------------------------------------------------ |
| `test/index.test.ts`      | Worker integration (method check, auth, Axiom forward) |
| `test/verify.test.ts`     | HMAC-SHA1 signature verification                       |
| `test/transform.test.ts`  | Classification, expansion, mapping, full pipeline      |
| `test/fixtures.ts`        | Synthetic input/output pairs covering each event type  |
