# Business domain human query (AI intent → safe observability queries)

AWS CDK app that implements the architecture in **[`code_generation_context.md`](./code_generation_context.md)**:

1. **Natural language** (or passthrough JSON) → **`POST /intent`** → **structured `StructuredQueryIntent`** (no raw CloudWatch Insights from “AI”).
2. **Structured intent** → **`POST /query/build`** → **domain query builders** → **Logs Insights query string** + **X-Ray filter expression** + metadata for **Grafana** / operators.

**Developer guide (CDK wiring, contracts, extension patterns, curl):** **[README-dev.md](./README-dev.md)**.

## Layout

| Path | Role |
| ---- | ---- |
| `lib/business-domain-human-query-stack.ts` | HTTP API (API Gateway HTTP API v2), Lambdas, X-Ray tracing |
| `lambda/intent-extract/` | Demo keyword “AI”; production: swap for Bedrock/OpenAI returning only JSON matching `shared/query-intent.ts` |
| `lambda/query-dispatch/` | Validates `domain` + `intent` against `shared/domain-registry.ts`, calls `domain-builders/*` |
| `lambda/domain-builders/` | Per-domain **trusted** query construction |
| `lambda/shared/query-intent.ts` | Contract types |

## Prerequisites

- Node **20+**
- AWS credentials for deploy (`CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` or profile)

## Commands

```bash
npm install
npm run build
npx cdk bootstrap aws://ACCOUNT/REGION   # once per account/region
npx cdk synth -c stage=dev
npx cdk deploy --all -c stage=dev      # uses CDK_DEFAULT_ACCOUNT or context; set env for real deploy
```

`stage=dev` in **`bin/business-domain-human-query-app.ts`** defaults the stack env to account **`000000000000`** only if you omit `CDK_DEFAULT_ACCOUNT` — override with **`CDK_DEFAULT_ACCOUNT`** / **`CDK_DEFAULT_REGION`** for a real deploy. **`NodejsFunction`** requires the default CDK bootstrap (asset publishing); **`BootstraplessSynthesizer`** is not used here because it cannot publish bundled Lambda assets.

Outputs: **`HttpApiUrl`**.

## API

### `POST {HttpApiUrl}/intent`

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
    "timeRange": { "value": 24, "unit": "hour" },
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
- Replace **`intent-extract`** with a model that **only** emits **`StructuredQueryIntent`** (JSON schema validation recommended).
