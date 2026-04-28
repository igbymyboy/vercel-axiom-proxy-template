export interface Env {
  AXIOM_API_TOKEN: string;
  AXIOM_DATASET: string;
  VERCEL_DRAIN_SECRET: string;
}

export interface VercelProxy {
  clientIp?: string;
  host?: string;
  lambdaRegion?: string;
  method?: string;
  path?: string;
  pathType?: string;
  pathTypeVariant?: string;
  region?: string;
  scheme?: string;
  statusCode?: number;
  timestamp?: number;
  userAgent?: string[];
  vercelCache?: string;
  vercelId?: string;
  referer?: string;
  cacheId?: string;
}

export interface VercelEvent {
  id?: string;
  message?: string;
  timestamp?: number;
  type?: string;
  level?: string;
  branch?: string;
  invocationId?: string;
  requestId?: string;
  statusCode?: number;
  proxy?: VercelProxy;
  deploymentId?: string;
  host?: string;
  environment?: string;
  projectId?: string;
  projectName?: string;
  executionRegion?: string;
  path?: string;
  source?: string;
  [key: string]: unknown;
}

export interface TransformedEvent {
  _time?: string;
  level?: string;
  message?: string;
  app?: Record<string, unknown>;
  request?: {
    id?: string;
    ip?: string;
    host?: string;
    method?: string;
    path?: string;
    statusCode?: number;
    userAgent?: string;
    vercelCache?: string;
    scheme?: string;
    referer?: string;
    cacheId?: string;
  };
  report?: ReportFields;
  vercel?: {
    deploymentId?: string;
    deploymentURL?: string;
    environment?: string;
    projectId?: string;
    projectName?: string;
    region?: string;
    route?: string;
    source?: string;
  };
}

// --- Internal types for the transform pipeline ---

export type EventType = "pino-json" | "consolidated" | "plain-text";
export type EventSubType = "log-line" | "report";

export interface ReportFields {
  durationMs?: number;
  maxMemoryUsedMb?: number;
  initDurationMs?: number;
}

export interface ClassifiedEvent {
  type: EventType;
  subType?: EventSubType;
  raw: VercelEvent;
  parsedMessage?: Record<string, unknown>;
  parsedReport?: ReportFields;
  logMessage?: string;
}
