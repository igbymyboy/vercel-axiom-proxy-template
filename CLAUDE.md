# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cloudflare Worker that proxies Vercel log drain webhooks to Axiom's ingest API. Transforms raw Vercel events through a pipeline that classifies message types (Pino JSON, consolidated lambda, plain text), splits consolidated output into individual events, and remaps fields into clean `request.*`/`vercel.*`/`app.*`/`report.*` namespaces.

**Flow:** Vercel Log Drain → Cloudflare Worker (signature verify + transform pipeline) → Axiom Ingest API

**Axiom dataset:** `my-app-logs` — example dataset name; replace with your own in `wrangler.toml`.

## Commands

- `pnpm dev` — Local dev server via Wrangler
- `pnpm ship` — Deploy Worker to Cloudflare (local workaround until CI is set up)
- `pnpm test` — Run Vitest test suite (44 tests)
- `wrangler secret put <NAME>` — Set secrets (AXIOM_API_TOKEN, AXIOM_DATASET, VERCEL_DRAIN_SECRET)

## Architecture

TypeScript modules in `src/` with a transformation pipeline:

1. **Method check** (`src/index.ts`) — POST only (405 otherwise)
2. **Signature verification** (`src/verify.ts`) — HMAC-SHA1 of request body against `x-vercel-signature` header
3. **Event transformation** (`src/transform.ts`) — Pipeline: `expandEvent → mapToOutput`
   - `expandEvent` — Classifies each event by message content (pino-json, consolidated, plain-text) and expands consolidated events into log-line + report sub-events
   - `mapToOutput` — Calls `mapEnvelope` to remap envelope fields into `request.*`/`vercel.*` namespaces, then applies type-specific logic (Pino fields → `app.*`, consolidated log → `message`, report → `report.*`)
4. **Axiom forwarding** (`src/axiom.ts`) — POSTs transformed events to Axiom ingest API

Types defined in `src/types.ts`. No external production dependencies.

## Testing

Vitest with `@cloudflare/vitest-pool-workers`. Config in `vitest.config.ts`.

- `test/index.test.ts` — Worker integration tests (method check, auth, Axiom forwarding)
- `test/verify.test.ts` — Signature verification (integration + unit)
- `test/transform.test.ts` — Transformation pipeline (integration + unit)
- `test/fixtures.ts` — Representative input/output pairs covering each event type
- `test/helpers.ts` — Test utilities (sign, sendEvents)
