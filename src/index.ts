import type { Env, VercelEvent } from "./types";
import { verifySignature } from "./verify";
import { transformEvents } from "./transform";
import { ingest } from "./axiom";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Validate required env vars — fail fast
    for (const name of [
      "VERCEL_DRAIN_SECRET",
      "AXIOM_API_TOKEN",
      "AXIOM_DATASET",
    ] as const) {
      if (!env[name]) {
        console.error(JSON.stringify({ event: "missing_env_var", name }));
        return new Response("Internal configuration error", { status: 500 });
      }
    }

    try {
      const signature = request.headers.get("x-vercel-signature");
      const rawBody = await request.arrayBuffer();

      if (!signature) {
        console.warn(
          JSON.stringify({ event: "auth_failure", reason: "missing_signature" }),
        );
        return new Response("Invalid signature", { status: 401 });
      }

      const valid = await verifySignature(
        rawBody,
        signature,
        env.VERCEL_DRAIN_SECRET,
      );
      if (!valid) {
        console.warn(
          JSON.stringify({ event: "auth_failure", reason: "invalid_signature" }),
        );
        return new Response("Invalid signature", { status: 401 });
      }

      const body = new TextDecoder().decode(rawBody);
      let events: VercelEvent[];
      try {
        const parsed = JSON.parse(body);
        events = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        console.warn(JSON.stringify({ event: "invalid_json" }));
        return new Response("Invalid JSON body", { status: 400 });
      }

      const transformed = transformEvents(events);
      if (transformed.length === 0) {
        return new Response("OK", { status: 200 });
      }

      const axiomResponse = await ingest(
        transformed,
        env.AXIOM_DATASET,
        env.AXIOM_API_TOKEN,
      );

      if (!axiomResponse.ok) {
        const errBody = await axiomResponse.text();
        console.error(
          JSON.stringify({
            event: "axiom_ingest_failed",
            status: axiomResponse.status,
            body: errBody,
          }),
        );
        return new Response(`Axiom error: ${axiomResponse.status}`, {
          status: 502,
        });
      }

      return new Response("OK", { status: 200 });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (error.name === "TimeoutError" || error.name === "AbortError") {
        console.error(
          JSON.stringify({ event: "axiom_timeout", message: error.message }),
        );
        return new Response("Upstream timeout", { status: 504 });
      }

      if (error.name === "TypeError") {
        console.error(
          JSON.stringify({
            event: "axiom_network_error",
            message: error.message,
          }),
        );
        return new Response("Upstream network error", { status: 502 });
      }

      console.error(
        JSON.stringify({
          event: "unhandled_exception",
          message: error.message,
        }),
      );
      return new Response("Internal server error", { status: 500 });
    }
  },
};
