# Developer guide — business domain human query (AI intent → safe queries)

This document complements **[README.md](./README.md)**. It explains **repository layout**, **design intent** (why layers are split), **CDK wiring**, **Lambda contracts**, and **how to extend** domain builders and the intent layer. Paths use **relative links** so they stay clickable in VS Code / GitHub.

**Primary architecture reference:** **[code_generation_context.md](./code_generation_context.md)** — semantic analytics: NL → structured intent → **trusted** query builders → CloudWatch Logs Insights / X-Ray text (never raw model-generated Insights).

---

## Table of contents

1. [Goals and separation of concerns](#goals-and-separation-of-concerns)
2. [Repository map](#repository-map)
3. [CDK app entry and stage / env](#cdk-app-entry-and-stage--env)
4. [Stack: HTTP API and Lambdas](#stack-http-api-and-lambdas)
5. [Contract: `StructuredQueryIntent` and `BuiltQueries`](#contract-structuredqueryintent-and-builtqueries)
6. [Domain registry and validation](#domain-registry-and-validation)
7. [Dispatcher and domain builders](#dispatcher-and-domain-builders)
8. [Intent Lambda (AI placeholder + X-Ray)](#intent-lambda-ai-placeholder--x-ray)
9. [Query dispatch Lambda](#query-dispatch-lambda)
10. [CDK context: default log groups](#cdk-context-default-log-groups)
11. [Build, synth, deploy](#build-synth-deploy)
12. [HTTP examples (curl)](#http-examples-curl)
13. [Security and operational checklist](#security-and-operational-checklist)
14. [Future work (Step Functions, Bedrock, execution)](#future-work-step-functions-bedrock-execution)

---

## Goals and separation of concerns

| Layer | Responsibility | Must **not** do |
| ----- | -------------- | --------------- |
| **AI / NL** ([`lambda/intent-extract/index.ts`](./lambda/intent-extract/index.ts)) | Produce **`StructuredQueryIntent`** (domain, intent, filters, time range, viz hint) | Emit CloudWatch Insights query strings or arbitrary SQL-like text |
| **Domain builders** ([`lambda/domain-builders/`](./lambda/domain-builders/)) | Validate against registry; build **parameterized** Logs Insights + X-Ray filter strings | Trust unvalidated user strings as query structure |
| **Infra** ([`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts)) | API Gateway v2, Node 20 Lambdas, X-Ray tracing, env for log group hints | Encode business query rules (keep in TS builders) |

End-to-end flow:

```text
POST /intent   →  { structuredIntent }
POST /query/build (body = structuredIntent)  →  { builtQueries: { logsInsightsQuery, xrayFilterExpression, logGroupNames, notes } }
```

---

## Repository map

| Path | Role |
| ---- | ---- |
| [`bin/business-domain-human-query-app.ts`](./bin/business-domain-human-query-app.ts) | CDK **`App`**, reads **`stage`** from context, constructs stack **`env`** via [`lib/stage-config.ts`](./lib/stage-config.ts) |
| [`lib/stage-config.ts`](./lib/stage-config.ts) | **`local` \| `dev` \| `test` \| `prod`**; LocalStack dummy account vs **`CDK_DEFAULT_ACCOUNT`** |
| [`scripts/deploy-local-localstack.mjs`](./scripts/deploy-local-localstack.mjs) | Bootstrap + **`cdk deploy`** against LocalStack (**`stage=local`**) |
| [`scripts/destroy-local-localstack.mjs`](./scripts/destroy-local-localstack.mjs) | **`cdk destroy`** on LocalStack (**`stage=local`**) |
| [`README-test.md`](./README-test.md) | Vitest + Playwright E2E |
| [`LOCALSTACK.md`](./LOCALSTACK.md) | LocalStack install / env for **`deploy:local`** |
| [`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts) | **`BusinessDomainHumanQueryStack`**: HTTP API, two **`NodejsFunction`**s, outputs |
| [`lambda/intent-extract/index.ts`](./lambda/intent-extract/index.ts) | **`POST /intent`** — demo NL → intent; optional **`structuredIntent`** passthrough |
| [`lambda/query-dispatch/index.ts`](./lambda/query-dispatch/index.ts) | **`POST /query/build`** — validates body, calls **`buildQueriesForIntent`** |
| [`lambda/domain-builders/index.ts`](./lambda/domain-builders/index.ts) | **`buildQueriesForIntent`** — registry check + **`switch (domain)`** |
| [`lambda/domain-builders/warehouse.ts`](./lambda/domain-builders/warehouse.ts) (and `manufacturing.ts`, `finance.ts`, `ordering.ts`) | Per-domain **trusted** query construction |
| [`lambda/shared/query-intent.ts`](./lambda/shared/query-intent.ts) | **`StructuredQueryIntent`**, **`BuiltQueries`** types |
| [`lambda/shared/domain-registry.ts`](./lambda/shared/domain-registry.ts) | **`DOMAIN_REGISTRY`**, **`validateIntentAgainstRegistry`** |
| [`cdk.json`](./cdk.json) | **`app`**, **`context.humanQuery`** default log group arrays |
| [`code_generation_context.md`](./code_generation_context.md) | Product / architecture narrative |
| [`README.md`](./README.md) | Operator quick start and API summary |

---

## CDK app entry and stage / env

**Files:** [`bin/business-domain-human-query-app.ts`](./bin/business-domain-human-query-app.ts), [`lib/stage-config.ts`](./lib/stage-config.ts)

**Stages** (same convention as **`aws_cdk_invoice_processing_and_approval`**):

- **`local`** — CDK **`env.account`** is **`000000000000`**; deploy with **`npm run deploy:local`** (sets **`AWS_ENDPOINT_URL`**, dummy keys, path-style S3). See **[LOCALSTACK.md](./LOCALSTACK.md)**.
- **`dev`**, **`test`**, **`prod`** — **`env.account`** = **`CDK_DEFAULT_ACCOUNT`** (unset for synth-only if your CDK setup allows), **`env.region`** from **`CDK_DEFAULT_REGION`** / **`AWS_DEFAULT_REGION`** / default **`us-east-1`**.

Default context stage when omitted is **`dev`** (`parseStage`).

```typescript
const stage = parseStage(app.node.tryGetContext("stage") as string | undefined);
const env = stackEnvForStage(stage);

new BusinessDomainHumanQueryStack(app, `BusinessDomainHumanQuery-${stage}`, {
  stage,
  env,
  description: `Semantic analytics API (intent + query builders) — ${stage}`,
});
```

**Note:** **`NodejsFunction`** publishes assets during **`cdk deploy`** / synth asset build — use **`cdk bootstrap`** for the target account/region (see [README.md — Commands](./README.md)).

---

## Stack: HTTP API and Lambdas

**File:** [`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts)

**Intent:**

- **API Gateway HTTP API (v2)** with CORS for **`POST`** + **`OPTIONS`** (`allowOrigins: ["*"]` — tighten for **`prod`** if you expose browser clients).
- Two **`NodejsFunction`**s (**esbuild** bundle, **`externalModules: ["@aws-sdk/*"]`**).
- **X-Ray:** **`tracing: lambda.Tracing.ACTIVE`** on both functions.
- **Environment:** comma-separated default log group lists from **`cdk.json` → `context.humanQuery`** (joined in the stack and passed as **`DEFAULT_*_LOG_GROUPS`** strings).

**Snippet — shared Lambda defaults and intent function:**

```typescript
const lambdaDefaults = {
  runtime: lambda.Runtime.NODEJS_20_X,
  timeout: Duration.seconds(30),
  memorySize: 512,
  tracing: lambda.Tracing.ACTIVE,
  environment: commonEnv,
  bundling: {
    minify: true,
    sourceMap: true,
    externalModules: ["@aws-sdk/*"],
  },
};

const intentFn = new NodejsFunction(this, "IntentExtractFn", {
  ...lambdaDefaults,
  entry: path.join(__dirname, "..", "lambda", "intent-extract", "index.ts"),
  handler: "handler",
});
```

**Routes (same file):**

- **`POST /intent`** → **`intentFn`**
- **`POST /query/build`** → **`queryFn`**

**Outputs:** **`HttpApiUrl`**, **`Stage`**.

---

## Contract: `StructuredQueryIntent` and `BuiltQueries`

**File:** [`lambda/shared/query-intent.ts`](./lambda/shared/query-intent.ts)

**Intent:** this is the **only** JSON shape the AI layer should emit (validated / extended in your real pipeline). **`BuiltQueries`** is what **your code** returns to operators / Grafana.

```typescript
export interface StructuredQueryIntent {
  domain: QueryDomain | string;
  intent: string;
  entityFilters?: Record<string, string | number | boolean>;
  timeRange?: { value: number; unit: TimeUnit };
  visualization?: "timeseries" | "table" | "stat";
  sourceQuestion?: string;
}

export interface BuiltQueries {
  logsInsightsQuery: string;
  xrayFilterExpression: string;
  logGroupNames: string[];
  notes: string[];
}
```

---

## Domain registry and validation

**File:** [`lambda/shared/domain-registry.ts`](./lambda/shared/domain-registry.ts)

**Intent:** scalable **registry** — each domain lists **`supportedIntents`** and documents **X-Ray annotation keys** upstream services should emit (see [code_generation_context.md — X-Ray](./code_generation_context.md)).

```typescript
export const DOMAIN_REGISTRY: Record<string, DomainRegistryEntry> = {
  warehouse: {
    supportedIntents: ["inventory_delay_analysis", "shipment_failure_analysis"],
    xrayAnnotationKeys: ["warehouseId", "operationType", "delayMs", "productCategory", "status"],
  },
  // manufacturing, finance, ordering …
};

export function validateIntentAgainstRegistry(domain: string, intent: string): string | null {
  const entry = DOMAIN_REGISTRY[domain];
  if (!entry) return `Unknown domain "${domain}". Known: ${Object.keys(DOMAIN_REGISTRY).join(", ")}`;
  if (!entry.supportedIntents.includes(intent)) {
    return `Intent "${intent}" not supported for domain "${domain}". Allowed: ${entry.supportedIntents.join(", ")}`;
  }
  return null;
}
```

---

## Dispatcher and domain builders

**File:** [`lambda/domain-builders/index.ts`](./lambda/domain-builders/index.ts)

**Intent:** single entry **`buildQueriesForIntent(intent, process.env)`** — validate first, then route. Log group lists come from **`DEFAULT_WAREHOUSE_LOG_GROUPS`** etc. (comma-separated), parsed by **`parseLogGroupsCsv`**.

```typescript
export function buildQueriesForIntent(intent: StructuredQueryIntent, env: NodeJS.ProcessEnv): BuiltQueries {
  const err = validateIntentAgainstRegistry(intent.domain, intent.intent);
  if (err) throw new Error(err);

  const warehouseLgs = parseLogGroupsCsv(env.DEFAULT_WAREHOUSE_LOG_GROUPS);
  // …

  switch (intent.domain) {
    case "warehouse":
      if (intent.intent === "inventory_delay_analysis") {
        return buildWarehouseQueries(intent, warehouseLgs);
      }
      return buildWarehouseShipmentFailure(intent, warehouseLgs);
    case "manufacturing":
      return buildManufacturingQueries(intent, manufacturingLgs);
    // …
  }
}
```

**Example builder (warehouse delays):** [`lambda/domain-builders/warehouse.ts`](./lambda/domain-builders/warehouse.ts)

```typescript
export function buildWarehouseQueries(
  intent: StructuredQueryIntent,
  defaultLogGroups: string[],
): BuiltQueries {
  const warehouseId = String(intent.entityFilters?.warehouseId ?? "*");
  const hours = hoursFromTimeRange(intent);
  const logGroups = defaultLogGroups.length ? defaultLogGroups : ["/aws/lambda/warehouse-service-demo"];

  const logsInsightsQuery = [
    `fields @timestamp, @message`,
    `| filter @message like /delay|inventory|warehouse/i`,
    // … entity + time filters …
  ]
    .filter(Boolean)
    .join("\n");

  const xrayFilter =
    warehouseId !== "*"
      ? `annotation.warehouseId = "${escapeFilterValue(warehouseId)}" AND annotation.delayMs > 1000`
      : `annotation.delayMs > 1000`;

  return { logsInsightsQuery, xrayFilterExpression: xrayFilter, logGroupNames: logGroups, notes: [...] };
}
```

### Adding a new domain

1. Extend **`QueryDomain`** (optional) in [`lambda/shared/query-intent.ts`](./lambda/shared/query-intent.ts) if you want a closed union.
2. Add a **`DOMAIN_REGISTRY[...]`** entry with **`supportedIntents`** and **`xrayAnnotationKeys`** in [`lambda/shared/domain-registry.ts`](./lambda/shared/domain-registry.ts).
3. Add **`lambda/domain-builders/<domain>.ts`** exporting **`buildXQueries(intent, logGroups): BuiltQueries`**.
4. Wire **`case "<domain>":`** in [`lambda/domain-builders/index.ts`](./lambda/domain-builders/index.ts).
5. (Optional) Add **`default...LogGroups`** under **`context.humanQuery`** in [`cdk.json`](./cdk.json) and plumb env in [`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts).

### Adding a new intent under an existing domain

1. Add the intent string to **`supportedIntents`** for that domain in [`lambda/shared/domain-registry.ts`](./lambda/shared/domain-registry.ts).
2. In the domain’s builder file (e.g. [`warehouse.ts`](./lambda/domain-builders/warehouse.ts)), add a dedicated function or branch inside the existing **`switch`** in [`index.ts`](./lambda/domain-builders/index.ts).

---

## Intent Lambda (AI placeholder + X-Ray)

**File:** [`lambda/intent-extract/index.ts`](./lambda/intent-extract/index.ts)

**Intent:**

- **Production:** replace keyword logic with **Bedrock / OpenAI / Anthropic** constrained to output **JSON matching `StructuredQueryIntent`** (JSON Schema validation recommended).
- **Tests:** send **`{ "structuredIntent": { ... } }`** to bypass NL (**`mode: "passthrough"`**).
- **X-Ray:** **`AWSXRay.getSegment()?.addAnnotation(...)`** for **`handler`**, **`domain`**, **`intent`**.

**Passthrough snippet:**

```typescript
const passthrough = raw.structuredIntent as StructuredQueryIntent | undefined;
if (passthrough?.domain && passthrough?.intent) {
  if (seg) seg.addAnnotation("domain", String(passthrough.domain));
  return json(200, { structuredIntent: passthrough, mode: "passthrough" });
}
```

---

## Query dispatch Lambda

**File:** [`lambda/query-dispatch/index.ts`](./lambda/query-dispatch/index.ts)

**Intent:** HTTP adapter only — parse JSON body as **`StructuredQueryIntent`**, call **`buildQueriesForIntent`**, return **`builtQueries`**. Does **not** call **`logs:StartQuery`** in v0 (operators paste into Console / Grafana); add IAM + SDK call if you add execution.

```typescript
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const raw = event.body ? JSON.parse(event.body) : {};
  const intent = raw as StructuredQueryIntent;
  if (!intent?.domain || !intent?.intent) {
    return json(400, { error: "Body must include domain and intent (StructuredQueryIntent)" });
  }
  const built = buildQueriesForIntent(intent, process.env);
  return json(200, { intent, builtQueries: built, hint: "…" });
};
```

---

## CDK context: default log groups

**File:** [`cdk.json`](./cdk.json)

**Intent:** placeholder log group names per domain for **`logGroupNames`** in **`BuiltQueries`** and for operators to swap to real groups.

```json
"context": {
  "humanQuery": {
    "defaultWarehouseLogGroups": ["/aws/lambda/warehouse-service-demo"],
    "defaultManufacturingLogGroups": ["/aws/lambda/manufacturing-service-demo"],
    "defaultFinanceLogGroups": ["/aws/lambda/finance-service-demo"],
    "defaultOrderingLogGroups": ["/aws/lambda/ordering-service-demo"]
  }
}
```

The stack reads these in [`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts) via **`this.node.tryGetContext("humanQuery")`** and passes them as env vars to both Lambdas.

---

## Build, synth, deploy

```bash
npm install
npm run build
npm test
npx cdk synth -c stage=dev
npx cdk bootstrap aws://ACCOUNT/REGION   # once per account/region
npm run deploy:prod                      # or deploy:dev / deploy:test
```

**LocalStack:** `npm run deploy:local` / **`destroy:local`** — see **[LOCALSTACK.md](./LOCALSTACK.md)**.

**Tests:** **[README-test.md](./README-test.md)** (Vitest + Playwright E2E).

**Synth note:** **`NodejsFunction`** triggers esbuild bundling during synth; ensure Docker is available if the CDK bundling pipeline uses it (platform-dependent).

---

## HTTP examples (curl)

Replace **`$API`** with **`HttpApiUrl`** from stack outputs.

**1) Natural language (demo keywords)**

```bash
curl -sS -X POST "$API/intent" \
  -H "content-type: application/json" \
  -d '{"message":"Show inventory delays in Sydney warehouse over last 24 hours"}'
```

**2) Passthrough intent (tests / CI)**

```bash
curl -sS -X POST "$API/intent" \
  -H "content-type: application/json" \
  -d '{"structuredIntent":{"domain":"warehouse","intent":"inventory_delay_analysis","entityFilters":{"warehouseId":"SYD-1"},"timeRange":{"value":24,"unit":"hour"},"visualization":"timeseries"}}'
```

**3) Build queries**

```bash
curl -sS -X POST "$API/query/build" \
  -H "content-type: application/json" \
  -d '{"domain":"warehouse","intent":"inventory_delay_analysis","entityFilters":{"warehouseId":"SYD-1"},"timeRange":{"value":24,"unit":"hour"},"visualization":"timeseries"}'
```

---

## Security and operational checklist

- **Never** accept a raw Logs Insights string from the client for execution — only **`StructuredQueryIntent`** fields that builders whitelist.
- **Sanitize** any user-controlled string interpolated into Insights / X-Ray fragments (see **`escapeFilterValue`** in [`warehouse.ts`](./lambda/domain-builders/warehouse.ts)); extend the same discipline to other builders.
- **Cost:** tighten time windows (`hoursFromTimeRange` caps) and **`limit`** clauses before enabling automated **`StartQuery`**.
- **X-Ray:** instrument producer services with annotations listed in **`DOMAIN_REGISTRY`** so **`xrayFilterExpression`** is selective (see [code_generation_context.md](./code_generation_context.md)).

---

## Future work (Step Functions, Bedrock, execution)

| Idea | Where to touch |
| ---- | -------------- |
| Async **Logs Insights** execution (`StartQuery` / `GetQueryResults`) | New Lambda or extend [`query-dispatch`](./lambda/query-dispatch/index.ts); IAM in [`business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts) |
| **Step Functions** orchestrating intent → approval → query | New **`aws-cdk-lib/aws-stepfunctions`** chain in stack |
| **API keys / JWT** on HTTP API | **`HttpRoute`** authorizers in stack |
| **Bedrock** guarded tool-use returning **`StructuredQueryIntent`** | Replace body of [`intent-extract`](./lambda/intent-extract/index.ts); add IAM + model ID env |

---

## Related reading

- [README.md](./README.md) — quick start, stages, API overview  
- [README-test.md](./README-test.md) — unit tests and Playwright E2E  
- [LOCALSTACK.md](./LOCALSTACK.md) — `stage=local` deploy  
- [code_generation_context.md](./code_generation_context.md) — architecture intent and Grafana / X-Ray narrative  
