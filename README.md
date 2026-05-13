# Business domain human query (AI intent → safe observability queries)

AWS CDK app that implements the architecture in **[`code_generation_context.md`](./code_generation_context.md)** and the visualization layer in **[`code_generation_context_2.md`](./code_generation_context_2.md)**:

1. **Natural language** (or passthrough JSON) → **`POST /intent`** → **structured `StructuredQueryIntent`** (no raw CloudWatch Insights from “AI”).
2. **Structured intent** → **`POST /query/build`** → **domain query builders** → **Logs Insights query string** + **X-Ray filter expression** + metadata for **Grafana** / operators.
3. **Built query** (or `structuredIntent`) → **`POST /visualize`** → **Grafana variable-driven dashboard URL** (`?var-dynamicQuery=...`) + optional Image Renderer PNG. Grafana is assumed to be **AWS-hosted** (Amazon Managed Grafana) for every stage, including **`local`**.

**Developer guide:** **[README-dev.md](./README-dev.md)** · **LocalStack:** **[LOCALSTACK.md](./LOCALSTACK.md)** · **Windows CDK bundling:** **[WINDOWS-CDK-BUNDLING.md](./WINDOWS-CDK-BUNDLING.md)**

**Testing:** **[README-test.md](./README-test.md)** — **Unit:** `npm test` or `npm run test:watch`. **E2E:** run `npm run test:e2e:install` once; deploy the HTTP API (e.g. `npm run deploy:local`); set **`PLAYWRIGHT_API_BASE_URL`** to **HttpApiUrl** (or run **`npm run playwright:print-env`** and paste the printed line); then **`npm run test:e2e`** (or **`npm run test:e2e:ui`**).

## `AI_MODE` (intent Lambda)

- **`AI_MOCK`** (default): keyword / regex router in `lambda/intent-extract/mock-extract.ts` (no external API).
- **`OPENAI`**: Chat Completions JSON mode; set **`OPENAI_API_KEY`** on the Lambda (do not commit). Optional: **`OPENAI_MODEL`** (default `gpt-4o-mini`), **`OPENAI_API_BASE`** (default `https://api.openai.com/v1`).
- **`BEDROCK`**: `InvokeModel` with Anthropic Messages on Bedrock; optional **`BEDROCK_MODEL_ID`** (default `anthropic.claude-3-haiku-20240307-v1:0`), **`BEDROCK_REGION`** (default Lambda region). CDK attaches `bedrock:InvokeModel` when `AI_MODE` is `BEDROCK` at deploy time, or when **`-c grantBedrockInvoke=true`** (so you can keep mock at synth but enable Bedrock later via console env).

Deploy-time override (bakes **`AI_MODE`** into the Lambda environment):

- **Bash / sh:** `AI_MODE=OPENAI npx cdk deploy --all -c stage=dev`
- **PowerShell:** `$env:AI_MODE = 'BEDROCK'; npx cdk deploy --all -c stage=dev`
- **CDK context (no shell env):** `npx cdk deploy --all -c stage=dev -c aiMode=OPENAI`

After deploy, you can still edit **`AI_MODE`** (and secrets such as **`OPENAI_API_KEY`**) in the Lambda console; if you switch to **`BEDROCK`** without having deployed Bedrock IAM, run again with **`-c aiMode=BEDROCK`** or **`-c grantBedrockInvoke=true`**.

## Layout

| Path | Role |
| ---- | ---- |
| `lib/stage-config.ts` | Valid stages: `local` \| `dev` \| `test` \| `prod`; CDK `env` for LocalStack vs caller account |
| `lib/bundling-flags.ts` | Optional Docker bundling for `NodejsFunction` (see WINDOWS-CDK-BUNDLING.md) |
| `lib/business-domain-human-query-stack.ts` | HTTP API (API Gateway HTTP API v2), Lambdas, X-Ray tracing |
| `lambda/intent-extract/` | **`AI_MODE`**: `AI_MOCK` (default, keyword router), `OPENAI`, or `BEDROCK`; optional env: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_API_BASE`, `BEDROCK_MODEL_ID`, `BEDROCK_REGION` |
| `lambda/query-dispatch/` | Validates `domain` + `intent` against `shared/domain-registry.ts`, calls `domain-builders/*` |
| `lambda/domain-builders/` | Per-domain **trusted** query construction |
| `lambda/shared/query-intent.ts` | Contract types |

## Prerequisites

- Node **20+**
- For **`OPENAI`** / **`BEDROCK`** modes: configure the intent Lambda (API keys, model IDs, Bedrock model access in the account) as described in **[README.md — AI_MODE](./README.md#ai_mode-intent-lambda)**.
- For **`dev` / `test` / `prod`**: AWS credentials and **`CDK_DEFAULT_ACCOUNT`** / **`CDK_DEFAULT_REGION`** (or equivalent profile) for deploy
- For **`local`**: LocalStack running; see **[LOCALSTACK.md](./LOCALSTACK.md)**

## Stages (aligned with `aws_cdk_invoice_processing_and_approval`)

| Context `-c stage=` | Account / target | Typical deploy |
| ------------------- | ---------------- | -------------- |
| **`local`** | **`000000000000`** + LocalStack endpoint | **`npm run deploy:local`** |
| **`dev`** | Caller default account/region | **`npm run deploy:dev`** |
| **`test`** | Caller default account/region | **`npm run deploy:test`** |
| **`prod`** | Caller default account/region | **`npm run deploy:prod`** |

Stack id: **`BusinessDomainHumanQuery-${stage}`** (e.g. `BusinessDomainHumanQuery-local`).

## Commands

```bash
npm install
npm run build
npm test                    # Vitest (no AWS)
npm run synth:local         # synth only, stage=local
```

If **`npm run synth:local`** fails on **Windows** with **PowerShell / CLR / esbuild** during **“Bundling asset …”**, start **Docker Desktop** and run **`npm run synth:local:docker`** (or see **[WINDOWS-CDK-BUNDLING.md](./WINDOWS-CDK-BUNDLING.md)**).

```bash
npm run deploy:local           # LocalStack: bootstrap + deploy (see LOCALSTACK.md)
npm run test:e2e:install       # once per machine: Playwright Chromium
npm run playwright:print-env   # copy printed PLAYWRIGHT_API_BASE_URL into your shell, then:
npm run test:e2e               # E2E HTTP calls (skipped if PLAYWRIGHT_API_BASE_URL unset)
npm run destroy:local          # tear down LocalStack stack
```

Deploy script order: **`npm run build`** → **`cdk bootstrap`** (skippable with **`CDK_SKIP_BOOTSTRAP=1`**) → **`cdk synth`** → **`cdk deploy --app <repo>/cdk.out`** (single bundle pass, then publish to LocalStack). If deploy fails, see **[LOCALSTACK.md § Troubleshooting](./LOCALSTACK.md#3-troubleshooting-deploy--destroy)** (`DEPLOY_LOCAL_VERBOSE`, region, **`AWS_PROFILE`**).

**AWS accounts** (after `cdk bootstrap aws://ACCOUNT/REGION` once per account/region):

```bash
npx cdk synth -c stage=dev
npx cdk deploy --all -c stage=dev
# or: npm run deploy:dev | deploy:test | deploy:prod
```

**`NodejsFunction`** publishes assets during deploy; do **not** use `BootstraplessSynthesizer` with bundled Lambdas.

Outputs: **`HttpApiUrl`**, **`Stage`**.

## API

### `POST {HttpApiUrl}/intent`

Successful responses include **`structuredIntent`** and **`mode`**: **`ai_mock`** (keyword router), **`openai`**, **`bedrock`**, or **`passthrough`** when the body already contained **`structuredIntent`**. Errors from model providers include **`error`** and **`aiMode`** (configured mode).

Body (either):

```json
{ "message": "Show inventory delays in Sydney warehouse over last 24 hours" }
```

Or passthrough for tests:

```json
{
  "structuredIntent": {
    "domain": "warehouse",
    "intent": "inventory_delay_analysis",
    "entityFilters": { "warehouseId": "SYD-1" },
    "timeRange": { value: 24, "unit": "hour" },
    "visualization": "timeseries"
  }
}
```

### `POST {HttpApiUrl}/query/build`

Body: full **`StructuredQueryIntent`** (e.g. copy `structuredIntent` from `/intent` response).

Response includes **`builtQueries.logsInsightsQuery`**, **`builtQueries.xrayFilterExpression`**, **`builtQueries.logGroupNames`**.

### `POST {HttpApiUrl}/visualize`

Takes a built query (or `structuredIntent` to build server-side) and returns a **Grafana variable-driven** dashboard URL — the dashboard's panel target is authored once as **`${dynamicQuery}`**, and `?var-dynamicQuery=<encoded query>` is appended at request time. This avoids the slow `POST /api/dashboards/db` round-trips, version churn, race conditions, and audit noise of mutating dashboard JSON per request (see **[`code_generation_context_2.md`](./code_generation_context_2.md)** — *Alternative cleaner design*).

Body:

```json
{
  "query": "fields @timestamp, latency | stats avg(latency) by bin(5m)",
  "dashboardUid": "ops-dash",
  "panelId": 4,
  "timeRange": { "value": 6, "unit": "hour" },
  "variables": { "region": "ap-southeast-2" }
}
```

Or pipe an intent through in one call (server runs the domain builder, then builds the URL):

```json
{
  "structuredIntent": {
    "domain": "warehouse",
    "intent": "inventory_delay_analysis",
    "entityFilters": { "warehouseId": "WH-1" },
    "timeRange": { "value": 24, "unit": "hour" },
    "visualization": "timeseries"
  }
}
```

Optional fields: **`variableName`** (default `dynamicQuery`), **`from`** / **`to`** (overrides `timeRange`), **`refresh`**, **`slug`**, **`region`**, **`render`** (fetch PNG via Grafana Image Renderer), **`mode`** (`variable` default, or legacy `panel_patch` that mutates dashboard JSON).

Response:

```json
{
  "grafana": {
    "mode": "variable",
    "grafanaMode": "AWS",
    "dashboardUid": "ops-dash",
    "variableName": "dynamicQuery",
    "panelId": 4,
    "dashboardUrl": "https://g-xxx.grafana-workspace.<region>.amazonaws.com/d/ops-dash?var-dynamicQuery=...&from=now-6h&to=now&panelId=4",
    "panelEmbedUrl": "https://.../d-solo/ops-dash?...",
    "timeRange": { "from": "now-6h", "to": "now" },
    "refresh": "30s",
    "datasourceUid": "cloudwatch",
    "region": "ap-southeast-2"
  },
  "query": "fields @timestamp, latency | stats avg(latency) by bin(5m)"
}
```

When `render: true` **and** `GRAFANA_RENDERER_ENABLED=1`, the response also includes `grafana.renderUrl`, `grafana.renderType`, and `grafana.renderBytesBase64` (PNG/CSV from `/render/d-solo/...`).

## Grafana — AWS-hosted assumption

The visualize Lambda assumes **Grafana is hosted by AWS** (Amazon Managed Grafana) **for every stage including `local`** — there is no LocalStack Grafana. The Lambda points at whatever workspace URL the operator wires in via context / env; for `stage=local` (LocalStack) it still calls out to the real AMG workspace if one is configured.

| Setting | Source | Default |
| ------- | ------ | ------- |
| `GRAFANA_URL` | `process.env.GRAFANA_URL` or `humanQuery.grafana.url` (cdk.json) | *unset → auto-fallback to `GRAFANA_MODE=MOCK`* |
| `GRAFANA_API_KEY` | env (plain) — service-account token | empty |
| `GRAFANA_API_KEY_SECRET_ARN` | env or `humanQuery.grafana.apiKeySecretArn` — Secrets Manager ARN (preferred) | empty; when set, `secretsmanager:GetSecretValue` is granted at deploy time |
| `GRAFANA_DEFAULT_DASHBOARD_UID` | env or context | empty (must be provided per request) |
| `GRAFANA_DEFAULT_VARIABLE_NAME` | env or context | `dynamicQuery` |
| `GRAFANA_DEFAULT_PANEL_ID` | env or context | `1` |
| `GRAFANA_DEFAULT_DATASOURCE_UID` | env or context | `cloudwatch` |
| `GRAFANA_DEFAULT_REGION` | env or context | stack region |
| `GRAFANA_RENDERER_ENABLED` | env or context | `false` (requires Grafana Image Renderer plugin on the workspace) |
| `GRAFANA_MODE` | env or `-c grafanaMode=` | `AWS` when `GRAFANA_URL` is set, else `MOCK` |

**Service-account token:** create a [Grafana service account](https://grafana.com/docs/grafana/latest/administration/service-accounts/) with **Editor** role (only `Viewer` is needed for variable-URL mode; **Editor** is needed for the legacy `panel_patch` mode and for the Image Renderer endpoint depending on workspace config). Store the token in **AWS Secrets Manager** and pass the ARN via **`GRAFANA_API_KEY_SECRET_ARN`** (CDK grants the Lambda `secretsmanager:GetSecretValue` automatically).

**Dashboard authoring:** create a Grafana **template variable** named `dynamicQuery` (Type: *Textbox*, no query); the target panel's CloudWatch Logs Insights expression is `${dynamicQuery}`. The dashboard JSON is then static — only `?var-dynamicQuery=...` changes per request, which is what makes this path fast.

### Does `stage=local` really POST to Grafana, or simulate?

Both, depending on three independent toggles. The Lambda **does not** spin up a LocalStack Grafana — that's the explicit "AWS-hosted always" assumption from **[`code_generation_context_2.md`](./code_generation_context_2.md)**. Whether the LocalStack-hosted Lambda actually hits a Grafana workspace over the network is decided at runtime by:

1. **`GRAFANA_MODE`** (`AWS` vs `MOCK`) — at deploy time CDK picks `AWS` when `GRAFANA_URL` is set, else `MOCK`. **`grafana-config.ts`** also auto-degrades `AWS → MOCK` at runtime when `GRAFANA_URL` is empty (so a half-configured Lambda still returns useful JSON instead of crashing).
2. **Request `mode`** — `variable` (default) vs `panel_patch`. The variable path is **pure URL construction** — no HTTP call from the Lambda, even in `AWS` mode. Grafana is hit by the **user's browser** when they open the returned URL.
3. **Request `render`** — when `true` **and** `GRAFANA_RENDERER_ENABLED=1`, the Lambda fetches a PNG/CSV from `/render/d-solo/...` server-side, which is the only path that requires the API key for a default-shaped request.

Resulting matrix for `stage=local`:

| `GRAFANA_URL` configured? | Request shape | Effective mode | Calls Grafana from the Lambda? |
| ------------------------- | ------------- | -------------- | ------------------------------ |
| **No** (default `cdk.json`) | *anything* | `MOCK` | **No** — returns the URL it *would* have built + `mockNote: "GRAFANA_MODE=MOCK …"` |
| **Yes** | `{ query, dashboardUid }` (default `mode: "variable"`) | `AWS` | **No** — pure string build of `?var-dynamicQuery=…`; browser hits Grafana when the URL is opened |
| **Yes** | `{ ..., render: true }` + `GRAFANA_RENDERER_ENABLED=1` | `AWS` | **Yes** — `GET /render/d-solo/...` from the LocalStack Lambda container |
| **Yes** | `{ ..., mode: "panel_patch", panelId }` | `AWS` | **Yes** — `GET /api/dashboards/uid/<uid>` then `POST /api/dashboards/db` (legacy path) |

LocalStack Lambdas run in Docker containers with default internet egress, so when the Lambda *does* call Grafana from `stage=local` it goes straight out to the public AMG workspace URL — there is no LocalStack proxy in front of Grafana.

**Forcing `stage=local` to hit a real AMG workspace:**

```powershell
$env:GRAFANA_URL = "https://g-xxxxx.grafana-workspace.ap-southeast-2.amazonaws.com"
$env:GRAFANA_API_KEY = "<service-account-token>"   # or set GRAFANA_API_KEY_SECRET_ARN
$env:GRAFANA_DEFAULT_DASHBOARD_UID = "ops-dash"
npm run deploy:local
```

**Forcing the simulated path even when `GRAFANA_URL` is set** (handy for offline tests):

```powershell
$env:GRAFANA_MODE = "MOCK"; npm run deploy:local
# or one-shot CDK context:
npx cdk deploy --all -c stage=local -c grafanaMode=MOCK
```

The stack output **`GrafanaMode`** echoes the effective mode after deploy so you can confirm which path the Lambda will take without invoking it.

## X-Ray annotations

Instrument upstream services with annotations listed in **`domain-registry.ts`** (`warehouseId`, `delayMs`, …) so X-Ray filters stay selective and cheap — see **`code_generation_context.md`**.

## Extending

- Add intents to **`DOMAIN_REGISTRY`** and a matching branch in **`domain-builders/index.ts`**.
- For NL → intent: set **`AI_MODE`** to **`OPENAI`** or **`BEDROCK`**, or extend **`lambda/intent-extract/mock-extract.ts`** / add a new strategy module wired from **`lambda/intent-extract/index.ts`**. Model output must remain **only** **`StructuredQueryIntent`**-shaped JSON (validated against the registry after parse); do not return raw Logs Insights strings from the model.
