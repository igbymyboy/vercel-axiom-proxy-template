import type { TransformedEvent } from "./types";

const AXIOM_INGEST_URL = "https://api.axiom.co/v1/datasets";

export async function ingest(
  events: TransformedEvent[],
  dataset: string,
  token: string,
): Promise<Response> {
  return fetch(`${AXIOM_INGEST_URL}/${dataset}/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(events),
    signal: AbortSignal.timeout(10_000),
  });
}
