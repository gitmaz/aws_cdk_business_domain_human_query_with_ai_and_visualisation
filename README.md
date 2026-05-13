# Business domain human query (AI intent → safe observability queries)

AWS CDK app that implements the architecture in **[`code_generation_context.md`](./code_generation_context.md)**:

1. **Natural language** (or passthrough JSON) → **`POST /intent`** → **structured `StructuredQueryIntent`** (no raw CloudWatch Insights from “AI”).
2. **Structured intent** → **`POST /query/build`** → **domain query builders** → **Logs Insights query string** + **X-Ray filter expression** + metadata for **Grafana** / operators.

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

## Grafana

Point Grafana’s **CloudWatch** / **X-Ray** data sources at the same account/region; paste generated queries into panels or use Grafana’s query editor with the returned expressions as a starting point.

## X-Ray annotations

Instrument upstream services with annotations listed in **`domain-registry.ts`** (`warehouseId`, `delayMs`, …) so X-Ray filters stay selective and cheap — see **`code_generation_context.md`**.

## Extending

- Add intents to **`DOMAIN_REGISTRY`** and a matching branch in **`domain-builders/index.ts`**.
- For NL → intent: set **`AI_MODE`** to **`OPENAI`** or **`BEDROCK`**, or extend **`lambda/intent-extract/mock-extract.ts`** / add a new strategy module wired from **`lambda/intent-extract/index.ts`**. Model output must remain **only** **`StructuredQueryIntent`**-shaped JSON (validated against the registry after parse); do not return raw Logs Insights strings from the model.
