import type {
  VercelEvent,
  TransformedEvent,
  ReportFields,
  ClassifiedEvent,
} from "./types";

const RE_DURATION = /(?<!\w)Duration:\s*([\d.]+)\s*ms/;
const RE_MAX_MEMORY = /Max Memory Used:\s*(\d+)\s*MB/;
const RE_INIT_DURATION = /Init Duration:\s*([\d.]+)\s*ms/;

/**
 * Extract the log line and REPORT metrics from a consolidated lambda message.
 *
 * Consolidated messages look like:
 *   START RequestId: ...
 *   [METHOD] /path status=NNN
 *   END RequestId: ...
 *   REPORT RequestId: ... Duration: N ms ... Max Memory Used: N MB [Init Duration: N ms]
 */
export function parseConsolidatedMessage(message: string): {
  logMessage?: string;
  report?: ReportFields;
} {
  const lines = message.split("\n");
  let logMessage: string | undefined;
  let report: ReportFields | undefined;

  for (const line of lines) {
    if (line.length === 0) continue;

    if (line.startsWith("START ") || line.startsWith("END ")) {
      continue;
    }

    if (line.startsWith("REPORT ")) {
      const durationMatch = line.match(RE_DURATION);
      const memoryMatch = line.match(RE_MAX_MEMORY);
      const initMatch = line.match(RE_INIT_DURATION);
      report = {
        durationMs: durationMatch ? parseFloat(durationMatch[1]) : undefined,
        maxMemoryUsedMb: memoryMatch ? parseInt(memoryMatch[1], 10) : undefined,
        initDurationMs: initMatch ? parseFloat(initMatch[1]) : undefined,
      };
      continue;
    }

    // First non-START/END/REPORT line is the log line
    if (logMessage === undefined) {
      logMessage = line;
    }
  }

  return { logMessage, report };
}

/**
 * Map shared envelope fields to the output schema's request.* and vercel.* namespaces.
 */
export function mapEnvelope(event: VercelEvent): TransformedEvent {
  const result: TransformedEvent = {};

  // _time from timestamp
  if (event.timestamp !== undefined) {
    result._time = new Date(event.timestamp).toISOString();
  }

  // level — default from Vercel envelope (may be overridden by caller for Pino)
  if (event.level !== undefined) result.level = event.level;

  // Build request namespace
  const request: TransformedEvent["request"] = {};
  let hasRequest = false;

  if (event.requestId !== undefined) {
    request.id = event.requestId;
    hasRequest = true;
  }

  if (event.proxy) {
    const p = event.proxy;
    if (p.clientIp !== undefined) {
      request.ip = p.clientIp;
      hasRequest = true;
    }
    if (p.host !== undefined) {
      request.host = p.host;
      hasRequest = true;
    }
    if (p.method !== undefined) {
      request.method = p.method;
      hasRequest = true;
    }
    if (p.path !== undefined) {
      request.path = p.path;
      hasRequest = true;
    }
    if (p.userAgent !== undefined) {
      request.userAgent = Array.isArray(p.userAgent)
        ? p.userAgent.join(" ")
        : p.userAgent;
      hasRequest = true;
    }
    if (p.vercelCache !== undefined) {
      request.vercelCache = p.vercelCache;
      hasRequest = true;
    }
    if (p.scheme !== undefined) {
      request.scheme = p.scheme;
      hasRequest = true;
    }
    if (p.referer !== undefined) {
      request.referer = p.referer;
      hasRequest = true;
    }
    if (p.cacheId !== undefined) {
      request.cacheId = p.cacheId;
      hasRequest = true;
    }

    // statusCode: prefer proxy, fall back to top-level
    const sc = p.statusCode ?? event.statusCode;
    if (sc !== undefined) {
      request.statusCode = sc;
      hasRequest = true;
    }
  } else if (event.statusCode !== undefined) {
    request.statusCode = event.statusCode;
    hasRequest = true;
  }

  if (hasRequest) result.request = request;

  // Build vercel namespace
  const vercel: TransformedEvent["vercel"] = {};
  let hasVercel = false;

  if (event.deploymentId !== undefined) {
    vercel.deploymentId = event.deploymentId;
    hasVercel = true;
  }
  if (event.host !== undefined) {
    vercel.deploymentURL = event.host;
    hasVercel = true;
  }
  if (event.environment !== undefined) {
    vercel.environment = event.environment;
    hasVercel = true;
  }
  if (event.projectId !== undefined) {
    vercel.projectId = event.projectId;
    hasVercel = true;
  }
  if (event.projectName !== undefined) {
    vercel.projectName = event.projectName;
    hasVercel = true;
  }
  if (event.executionRegion !== undefined) {
    vercel.region = event.executionRegion;
    hasVercel = true;
  }
  if (event.path !== undefined) {
    vercel.route = event.path;
    hasVercel = true;
  }
  if (event.source !== undefined) {
    vercel.source = event.source;
    hasVercel = true;
  }

  if (hasVercel) result.vercel = vercel;

  return result;
}

/**
 * Classify an event and expand into ClassifiedEvents.
 *
 * Detection chain (mutually exclusive):
 * 1. Starts with "START RequestId:" and contains newline → consolidated (1:2)
 * 2. Starts with "{" and JSON.parse yields an object → pino-json (1:1)
 * 3. Everything else → plain-text (1:1)
 */
export function expandEvent(event: VercelEvent): ClassifiedEvent[] {
  const msg = event.message;

  // Consolidated: starts with "START RequestId:" and has newlines
  if (
    typeof msg === "string" &&
    msg.startsWith("START RequestId:") &&
    msg.includes("\n")
  ) {
    const { logMessage, report } = parseConsolidatedMessage(msg);
    const results: ClassifiedEvent[] = [];
    if (logMessage !== undefined) {
      results.push({
        type: "consolidated",
        subType: "log-line",
        raw: event,
        logMessage,
      });
    }
    if (report !== undefined) {
      results.push({
        type: "consolidated",
        subType: "report",
        raw: event,
        parsedReport: report,
      });
    }
    return results;
  }

  // Pino JSON: starts with "{" and parses to a plain object
  if (typeof msg === "string" && msg.startsWith("{")) {
    try {
      const parsed = JSON.parse(msg);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return [{ type: "pino-json", raw: event, parsedMessage: parsed }];
      }
    } catch {
      // parse failed — fall through to plain-text
    }
  }

  // Plain text
  return [{ type: "plain-text", raw: event }];
}

// Pino numeric level → string mapping
const PINO_LEVELS: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

/**
 * Map a ClassifiedEvent to the final output schema.
 */
export function mapToOutput(classified: ClassifiedEvent): TransformedEvent {
  const base = mapEnvelope(classified.raw);

  switch (classified.type) {
    case "pino-json": {
      const pino = classified.parsedMessage!;
      // Promote Pino level to top-level
      const pinoLevel =
        typeof pino.level === "number"
          ? (PINO_LEVELS[pino.level] ?? String(pino.level))
          : typeof pino.level === "string"
            ? pino.level
            : undefined;
      if (pinoLevel !== undefined) base.level = pinoLevel;

      // Set message = Pino's msg
      if (typeof pino.msg === "string") base.message = pino.msg;

      // Build app.* — all Pino fields except level, time, and msg (already promoted to message)
      const { level: _, time: __, msg: ___, ...appFields } = pino;
      if (Object.keys(appFields).length > 0) base.app = appFields;

      return base;
    }

    case "consolidated": {
      if (classified.subType === "log-line") {
        base.message = classified.logMessage;
        if (base.vercel) base.vercel.source = "lambda-log";
        return base;
      }

      // report sub-event
      if (classified.parsedReport) {
        base.report = { ...classified.parsedReport };
      }
      // report events have no message, source stays "lambda"
      return base;
    }

    case "plain-text": {
      if (classified.raw.message !== undefined) {
        base.message = classified.raw.message;
      }
      return base;
    }

    default: {
      const _exhaustive: never = classified.type;
      throw new Error(`Unhandled event type: ${_exhaustive}`);
    }
  }
}

/**
 * Public entry point: transform raw Vercel events into the output schema.
 */
export function transformEvents(events: VercelEvent[]): TransformedEvent[] {
  return events.flatMap(expandEvent).map(mapToOutput);
}
