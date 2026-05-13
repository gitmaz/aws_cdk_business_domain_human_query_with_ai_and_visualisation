/**
 * Runtime config for the Grafana visualization Lambda.
 *
 * The user's premise (see `code_generation_context_2.md`) is that **Grafana is hosted by AWS for every
 * stage** — typically **Amazon Managed Grafana (AMG)** — so we never spin up our own Grafana for
 * `stage=local`. Instead the Lambda always points at the configured AWS-hosted workspace URL.
 *
 * Two ways to provide the Grafana service-account token (in precedence order):
 *
 * 1. **`GRAFANA_API_KEY_SECRET_ARN`** — Secrets Manager ARN; resolved at cold start via AWS SDK v3
 *    (the IAM permission is granted at deploy time when the context property is set).
 * 2. **`GRAFANA_API_KEY`** — plain env var; useful for `stage=local` against LocalStack-deployed
 *    Lambdas talking out to the real AWS-hosted Grafana workspace.
 *
 * **Mode** (`GRAFANA_MODE`):
 * - **`AWS`** (default) — call the real Grafana HTTP API.
 * - **`MOCK`** — return deterministic JSON without any outbound HTTP; used by unit tests and as a
 *   safe fallback when `GRAFANA_URL` is unset.
 */
export type GrafanaMode = "AWS" | "MOCK";

export interface GrafanaConfig {
  mode: GrafanaMode;
  url: string;
  apiKey: string;
  apiKeySecretArn: string;
  defaultDashboardUid: string;
  defaultVariableName: string;
  defaultPanelId: number | undefined;
  defaultDatasourceUid: string;
  defaultRegion: string;
  rendererEnabled: boolean;
  /** Server-side render size when `render: true`. */
  rendererWidth: number;
  rendererHeight: number;
}

export function resolveGrafanaMode(raw: string | undefined): GrafanaMode {
  const v = (raw ?? "").trim().toUpperCase();
  if (v === "MOCK") return "MOCK";
  return "AWS";
}

function parseIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseOptionalIntegerEnv(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const n = Number.parseInt(value.trim(), 10);
  return Number.isFinite(n) ? n : undefined;
}

function envTruthy(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Resolve config from `process.env`. Caller pass-in is supported so tests can inject
 * a deterministic snapshot without touching the global env.
 */
export function readGrafanaConfig(env: NodeJS.ProcessEnv = process.env): GrafanaConfig {
  const explicitMode = resolveGrafanaMode(env.GRAFANA_MODE);
  const url = env.GRAFANA_URL?.trim() ?? "";
  const apiKey = env.GRAFANA_API_KEY?.trim() ?? "";
  const apiKeySecretArn = env.GRAFANA_API_KEY_SECRET_ARN?.trim() ?? "";

  /**
   * Auto-fallback to MOCK when AWS mode was requested but no URL is configured.
   * Keeps `stage=local` synth / E2E useful before the operator wires a real AMG workspace.
   */
  const effectiveMode: GrafanaMode = explicitMode === "AWS" && !url ? "MOCK" : explicitMode;

  return {
    mode: effectiveMode,
    url,
    apiKey,
    apiKeySecretArn,
    defaultDashboardUid: env.GRAFANA_DEFAULT_DASHBOARD_UID?.trim() ?? "",
    defaultVariableName: env.GRAFANA_DEFAULT_VARIABLE_NAME?.trim() || "dynamicQuery",
    defaultPanelId: parseOptionalIntegerEnv(env.GRAFANA_DEFAULT_PANEL_ID),
    defaultDatasourceUid: env.GRAFANA_DEFAULT_DATASOURCE_UID?.trim() || "cloudwatch",
    defaultRegion: env.GRAFANA_DEFAULT_REGION?.trim() || env.AWS_REGION?.trim() || "us-east-1",
    rendererEnabled: envTruthy(env.GRAFANA_RENDERER_ENABLED),
    rendererWidth: parseIntegerEnv(env.GRAFANA_RENDERER_WIDTH, 1200),
    rendererHeight: parseIntegerEnv(env.GRAFANA_RENDERER_HEIGHT, 500),
  };
}

/**
 * Lazy-load the Grafana API key. If `GRAFANA_API_KEY_SECRET_ARN` is set, fetch from Secrets Manager;
 * otherwise return the plain env value. Cached per cold start.
 */
let cachedSecretValue: string | undefined;
let cachedSecretArn: string | undefined;

export async function resolveGrafanaApiKey(cfg: GrafanaConfig): Promise<string> {
  if (cfg.apiKeySecretArn) {
    if (cachedSecretValue && cachedSecretArn === cfg.apiKeySecretArn) {
      return cachedSecretValue;
    }
    // Dynamic import — keeps unit tests free of AWS SDK Secrets Manager unless the path is taken.
    const { SecretsManagerClient, GetSecretValueCommand } = await import(
      "@aws-sdk/client-secrets-manager"
    );
    const client = new SecretsManagerClient({});
    const out = await client.send(new GetSecretValueCommand({ SecretId: cfg.apiKeySecretArn }));
    const value = out.SecretString?.trim();
    if (!value) {
      throw new Error(
        `GRAFANA_API_KEY_SECRET_ARN secret "${cfg.apiKeySecretArn}" returned empty SecretString`,
      );
    }
    cachedSecretValue = value;
    cachedSecretArn = cfg.apiKeySecretArn;
    return value;
  }
  return cfg.apiKey;
}

/** Test-only: clear the in-memory secret cache. */
export function __resetGrafanaSecretCacheForTests(): void {
  cachedSecretValue = undefined;
  cachedSecretArn = undefined;
}
