# Business domain human query (AI intent → safe observability queries)

AWS CDK app that implements the architecture in **[`code_generation_context.md`](./code_generation_context.md)** and the visualization layer in **[`code_generation_context_2.md`](./code_generation_context_2.md)**:

1. **Natural language** (or passthrough JSON) → **`POST /intent`** → **structured `StructuredQueryIntent`** (no raw CloudWatch Insights from “AI”).
2. **Structured intent** → **`POST /query/build`** → **domain query builders** → **Logs Insights query string** + **X-Ray filter expression** + metadata for **Grafana** / operators.
3. **Built query** (or `structuredIntent`) → **`POST /visualize`** → **Grafana variable-driven dashboard URL** (`?var-dynamicQuery=...`) + optional Image Renderer PNG. Grafana is **stage-aware**: a **local Docker** Grafana (provisioned with CloudWatch + X-Ray datasources against LocalStack) for **`stage=local`**, and **Amazon Managed Grafana** (optionally CDK-created via `CfnWorkspace`) for **`dev` / `test` / `prod`**.

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

## Grafana — stage-aware backing

`GrafanaWorkspaceConstruct` (`lib/grafana-workspace-construct.ts`) decides where the visualize Lambda's `GRAFANA_URL` points based on stage. Two-stage strategy from **[`code_generation_context_2.md`](./code_generation_context_2.md) §"Grafana instance setup"**:

| Stage | Default backing | How it's created |
| ----- | --------------- | ---------------- |
| **`local`** | **Local Grafana Docker** with provisioned CloudWatch + X-Ray datasources pointing at LocalStack | `docker/grafana/docker-compose.yml` — `npm run grafana:local:up` |
| **`dev` / `test` / `prod`** | **Amazon Managed Grafana** (`grafana.CfnWorkspace`) when `humanQuery.grafana.aws.createWorkspace: true`, otherwise points at an existing AMG URL | CDK at deploy time |

Override at any stage by setting either `process.env.GRAFANA_URL` or `humanQuery.grafana.url` in `cdk.json` — operator URL always wins.

### Local Grafana Docker (`stage=local`)

Bring up the local Grafana + provisioned datasources:

```bash
npm run grafana:local:up                 # Grafana on http://localhost:3000 (anonymous Admin)
npm run grafana:local:up:renderer        # + Grafana Image Renderer sidecar for /render
npm run grafana:local:down               # stop
npm run grafana:local:down:purge         # stop + delete the persisted Grafana volume
```

Bundled provisioning (`docker/grafana/`):

- `provisioning/datasources/datasources.yaml` — **CloudWatch** (UID `cloudwatch`) and **X-Ray** (UID `xray`) datasources both pointing at LocalStack on `http://host.docker.internal:4566` with dummy `test`/`test` keys (matches `deploy:local`).
- `provisioning/dashboards/dashboards.yaml` + `dashboards/ai-query-playground.json` — sample dashboard `ai-query-playground` with a `dynamicQuery` textbox template variable; the panel's expression is `${dynamicQuery}` so the visualize Lambda's variable-driven URL Just Works.
- `grafana.ini` — anonymous **Admin** access (local-only), embed-friendly, telemetry off.

The CDK stack defaults `GRAFANA_URL=http://host.docker.internal:3000` for `stage=local`, which works from the LocalStack Lambda container on **Docker Desktop** (Mac/Windows). On **Linux**, choose one of:

1. **Shared bridge network (recommended).** The Grafana compose creates `human-query-net`. Launch LocalStack on the same network and the Lambda will reach Grafana via DNS:

   ```bash
   LAMBDA_DOCKER_NETWORK=human-query-net localstack start -d
   # then point the stack at the network alias
   GRAFANA_URL=http://grafana:3000 npm run deploy:local
   ```

2. **Host gateway alias.** Force LocalStack Lambda containers to resolve `host.docker.internal` to the host:

   ```bash
   LAMBDA_DOCKER_FLAGS="--add-host host.docker.internal:host-gateway" localstack start -d
   npm run deploy:local
   ```

Anonymous Grafana is the local default, so `GRAFANA_API_KEY` is **not** required. The Lambda picks this up via `GRAFANA_ALLOW_ANONYMOUS=1` (auto-set by the stack for `stage=local` when no key is configured).

### Amazon Managed Grafana via CDK (`dev` / `test` / `prod`)

Two prerequisites (one-time per org):

1. **Enable IAM Identity Center** (AMG's default auth provider): AWS Console → IAM Identity Center → Enable.
2. After workspace creation, assign your IAM Identity Center user via AWS Console → Amazon Managed Grafana → workspace → Authentication → Assign users/groups.

Then opt-in via context — either in `cdk.json`:

```json
{
  "context": {
    "humanQuery": {
      "grafana": {
        "aws": {
          "createWorkspace": true,
          "workspaceName": "human-query-dev",
          "authenticationProviders": ["AWS_SSO"],
          "permissionType": "SERVICE_MANAGED",
          "dataSources": ["CLOUDWATCH", "XRAY"],
          "notificationDestinations": ["SNS"]
        }
      }
    }
  }
}
```

or per-deploy CLI (top-level context flag, since `-c a:b:c=true` does not nest):

```bash
npx cdk deploy --all -c stage=dev -c createGrafanaWorkspace=true
# point at an existing AMG workspace without creating one:
npx cdk deploy --all -c stage=dev -c grafanaUrl=https://g-xxxxx.grafana-workspace.us-east-1.amazonaws.com
```

CDK creates a `CfnWorkspace` with service-managed IAM (CloudWatch + X-Ray datasources are auto-provisioned by AMG), and the stack outputs `GrafanaUrl=https://<endpoint>` is wired into the Lambda's `GRAFANA_URL` automatically.

To point at an **existing** AMG workspace instead, leave `createWorkspace: false` and set `humanQuery.grafana.url` (or `GRAFANA_URL` env) to the workspace endpoint.

### Environment-variable reference

| Setting | Source | Default |
| ------- | ------ | ------- |
| `GRAFANA_URL` | `process.env.GRAFANA_URL` → `humanQuery.grafana.url` → (`stage=local` only) `humanQuery.grafana.local.url` → created AMG endpoint | `http://host.docker.internal:3000` for `local`; AMG endpoint when created; else empty → `GRAFANA_MODE=MOCK` |
| `GRAFANA_API_KEY` | env (plain) — service-account token | empty (anonymous on local Docker; required for AMG `panel_patch`/`render`) |
| `GRAFANA_API_KEY_SECRET_ARN` | env or `humanQuery.grafana.apiKeySecretArn` — Secrets Manager ARN (preferred for AMG) | empty; when set, `secretsmanager:GetSecretValue` is granted |
| `GRAFANA_ALLOW_ANONYMOUS` | env or auto-set by CDK for `stage=local` when no key configured | `1` on `local` (no key); else empty |
| `GRAFANA_DEFAULT_DASHBOARD_UID` | env or context | `ai-query-playground` (matches the bundled dashboard) |
| `GRAFANA_DEFAULT_VARIABLE_NAME` | env or context | `dynamicQuery` |
| `GRAFANA_DEFAULT_PANEL_ID` | env or context | `1` |
| `GRAFANA_DEFAULT_DATASOURCE_UID` | env or context | `cloudwatch` |
| `GRAFANA_DEFAULT_REGION` | env or context | stack region (`us-east-1` for LocalStack) |
| `GRAFANA_RENDERER_ENABLED` | env or context | `false` (toggle on after `npm run grafana:local:up:renderer` or installing the Image Renderer plugin on AMG) |
| `GRAFANA_MODE` | env or `-c grafanaMode=` | `AWS` when `GRAFANA_URL` is non-empty, else `MOCK` |

**Service-account token (AMG only):** create a [Grafana service account](https://grafana.com/docs/grafana/latest/administration/service-accounts/) with **Editor** role (`Viewer` suffices for the default variable-URL mode; **Editor** is needed for `panel_patch` and renderer endpoints). Store in **AWS Secrets Manager** and pass the ARN via **`GRAFANA_API_KEY_SECRET_ARN`** — CDK grants the Lambda `secretsmanager:GetSecretValue` automatically.

**Dashboard authoring:** the bundled local dashboard already wires a `dynamicQuery` *Textbox* variable into two panels (timeseries + logs). For AMG, replicate the same pattern: create the variable as `dynamicQuery` and set the target panel's CloudWatch Logs Insights expression to `${dynamicQuery}` — keeps the dashboard JSON static and lets the Lambda update it via a URL parameter alone.

### Does `stage=local` really POST to Grafana, or simulate?

It depends on three independent toggles. By default with `npm run grafana:local:up` running, the Lambda calls the **local Docker Grafana** (not AWS) when HTTP is actually needed; the default `variable` mode does no Lambda-side HTTP at all.

1. **`GRAFANA_MODE`** (`AWS` vs `MOCK`) — at deploy time CDK picks `AWS` when `GRAFANA_URL` resolves (default for `stage=local` is the local Docker URL). `grafana-config.ts` auto-degrades `AWS → MOCK` at runtime when `GRAFANA_URL` is empty so a half-configured Lambda still returns useful JSON.
2. **Request `mode`** — `variable` (default) vs `panel_patch`. The variable path is **pure URL construction** — no HTTP call from the Lambda, even in `AWS` mode. Grafana is hit by the **user's browser** when they open the returned URL.
3. **Request `render`** — when `true` **and** `GRAFANA_RENDERER_ENABLED=1`, the Lambda fetches a PNG/CSV from `/render/d-solo/...` server-side.

Resulting matrix for `stage=local`:

| `GRAFANA_URL` resolves to … | Request shape | Effective mode | Calls Grafana from the Lambda? |
| ---------------------------- | ------------- | -------------- | ------------------------------ |
| empty (operator wiped default) | *anything* | `MOCK` | **No** — returns the URL it *would* have built + `mockNote` |
| local Docker (default) | `{ query }` (default `mode: "variable"`) | `AWS` | **No** — pure URL build; user's browser hits `http://localhost:3000` |
| local Docker (default) | `{ ..., render: true }` + `GRAFANA_RENDERER_ENABLED=1` | `AWS` | **Yes** — Lambda → `http://host.docker.internal:3000/render/...` (or `http://grafana:3000/...` on shared network) |
| local Docker (default) | `{ ..., mode: "panel_patch", panelId }` | `AWS` | **Yes** — Lambda → `GET/POST /api/dashboards/...` against local Docker Grafana |
| AMG URL (operator override) | `{ ..., render: true }` or `panel_patch` | `AWS` | **Yes** — Lambda → AMG workspace from the LocalStack container's egress |

**Force the simulated path** (handy for offline tests):

```powershell
$env:GRAFANA_MODE = "MOCK"; npm run deploy:local
# or one-shot CDK context:
npx cdk deploy --all -c stage=local -c grafanaMode=MOCK
```

**Force `stage=local` to hit AMG instead of local Docker:**

```powershell
$env:GRAFANA_URL = "https://g-xxxxx.grafana-workspace.ap-southeast-2.amazonaws.com"
$env:GRAFANA_API_KEY = "<service-account-token>"
npm run deploy:local
```

Stack outputs after deploy:
- **`GrafanaBacking`** — `local-docker` / `amg-created` / `amg-existing` / `none`.
- **`GrafanaMode`** — effective `AWS` or `MOCK`.
- **`GrafanaUrl`** — the actual endpoint baked into the Lambda env (only emitted when non-empty).

## X-Ray annotations

Instrument upstream services with annotations listed in **`domain-registry.ts`** (`warehouseId`, `delayMs`, …) so X-Ray filters stay selective and cheap — see **`code_generation_context.md`**.

## Extending

- Add intents to **`DOMAIN_REGISTRY`** and a matching branch in **`domain-builders/index.ts`**.
- For NL → intent: set **`AI_MODE`** to **`OPENAI`** or **`BEDROCK`**, or extend **`lambda/intent-extract/mock-extract.ts`** / add a new strategy module wired from **`lambda/intent-extract/index.ts`**. Model output must remain **only** **`StructuredQueryIntent`**-shaped JSON (validated against the registry after parse); do not return raw Logs Insights strings from the model.
