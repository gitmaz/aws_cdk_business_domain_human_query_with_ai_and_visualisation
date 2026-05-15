# Developer guide — business domain human query (AI intent → safe queries)

This document complements **[README.md](./README.md)**. It explains **repository layout**, **design intent** (why layers are split), **CDK wiring**, **Lambda contracts**, and **how to extend** domain builders and the intent layer. Paths use **relative links** so they stay clickable in VS Code / GitHub.

**Primary architecture reference:** **[code_generation_context.md](./code_generation_context.md)** — semantic analytics: NL → structured intent → **trusted** query builders → CloudWatch Logs Insights / X-Ray text (never raw model-generated Insights).

---

## Table of contents

1. [Goals and separation of concerns](#goals-and-separation-of-concerns)
2. [Repository map](#repository-map)
3. [CDK app entry and stage / env](#cdk-app-entry-and-stage--env)
4. [Stack: HTTP API and Lambdas](#stack-http-api-and-lambdas)
5. [Grafana visualization — who creates the dashboard?](#grafana-visualization--who-creates-the-dashboard)
6. [Contract: `StructuredQueryIntent` and `BuiltQueries`](#contract-structuredqueryintent-and-builtqueries)
7. [Domain registry and validation](#domain-registry-and-validation)
8. [Dispatcher and domain builders](#dispatcher-and-domain-builders)
9. [Intent Lambda (AI_MODE + X-Ray)](#intent-lambda-ai_mode--x-ray)
10. [Query dispatch Lambda](#query-dispatch-lambda)
11. [CDK context: default log groups](#cdk-context-default-log-groups)
12. [Build, synth, deploy](#build-synth-deploy)
13. [HTTP examples (curl)](#http-examples-curl)
14. [Security and operational checklist](#security-and-operational-checklist)
15. [Future work (Step Functions, Bedrock, execution)](#future-work-step-functions-bedrock-execution)

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
| [`lib/bundling-flags.ts`](./lib/bundling-flags.ts) | Opt-in **`forceDockerBundling`** for **`NodejsFunction`** (Windows PowerShell / CLR workarounds) |
| [`scripts/deploy-local-localstack.mjs`](./scripts/deploy-local-localstack.mjs) | Bootstrap + **`cdk deploy`** against LocalStack (**`stage=local`**) |
| [`scripts/destroy-local-localstack.mjs`](./scripts/destroy-local-localstack.mjs) | **`cdk destroy`** on LocalStack (**`stage=local`**) |
| [`README-test.md`](./README-test.md) | Vitest + Playwright E2E |
| [`LOCALSTACK.md`](./LOCALSTACK.md) | LocalStack install / env for **`deploy:local`** |
| [`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts) | **`BusinessDomainHumanQueryStack`**: HTTP API, two **`NodejsFunction`**s, outputs |
| [`lambda/intent-extract/index.ts`](./lambda/intent-extract/index.ts) | **`POST /intent`** — routes by **`AI_MODE`**: mock keywords, OpenAI Chat Completions, or Bedrock `InvokeModel`; optional **`structuredIntent`** passthrough |
| [`lambda/intent-extract/mock-extract.ts`](./lambda/intent-extract/mock-extract.ts) | **`AI_MOCK`**: keyword / regex NL → **`StructuredQueryIntent`** |
| [`lambda/intent-extract/openai-strategy.ts`](./lambda/intent-extract/openai-strategy.ts) | **`OPENAI`**: JSON-mode Chat Completions → parse + registry validation |
| [`lambda/intent-extract/bedrock-strategy.ts`](./lambda/intent-extract/bedrock-strategy.ts) | **`BEDROCK`**: Anthropic Messages on Bedrock → parse + registry validation |
| [`lambda/intent-extract/ai-mode.ts`](./lambda/intent-extract/ai-mode.ts) | **`resolveAiMode()`** — shared by Lambda handler and CDK stack |
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
- **`dev`**, **`test`**, **`prod`** — **`env.account`** = **`CDK_DEFAULT_ACCOUNT`** (unset for synth-only if your CDK setup allows), **`env.region`** from **`CDK_DEFAULT_REGION`** → **`AWS_DEFAULT_REGION`** → **`cdk.json` `context.defaultRegion`** → **`ap-southeast-2`** (see [`resolveDeployRegion`](./lib/stage-config.ts)).

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
- Two **`NodejsFunction`**s (**esbuild**). **`queryFn`** uses **`externalModules: ["@aws-sdk/*"]`** (no AWS SDK in bundle). **`intentFn`** overrides bundling with **`externalModules: []`** so **`@aws-sdk/client-bedrock-runtime`** ships in the artifact for Bedrock.
- **X-Ray:** **`tracing: lambda.Tracing.ACTIVE`** on both functions.
- **Environment:** comma-separated default log group lists from **`cdk.json` → `context.humanQuery`** (joined in the stack and passed as **`DEFAULT_*_LOG_GROUPS`** strings). **`intentFn`** additionally receives **`AI_MODE`** (resolved from **`-c aiMode`**, then **`process.env.AI_MODE`**, default **`AI_MOCK`**) and optional non-secret hints **`OPENAI_MODEL`**, **`OPENAI_API_BASE`**, **`BEDROCK_MODEL_ID`**, **`BEDROCK_REGION`** (from the deploy shell when set).
- **IAM:** when **`AI_MODE`** resolves to **`BEDROCK`** at synth/deploy, or when **`-c grantBedrockInvoke=true`**, **`intentFn`** gets **`bedrock:InvokeModel`** on foundation models and inference profiles in the stack region/account.

**Snippet — intent env, bundling override, Bedrock IAM (simplified):**

```typescript
import { resolveAiMode } from "../lambda/intent-extract/ai-mode";

const aiMode = resolveAiMode(
  (this.node.tryGetContext("aiMode") as string | undefined)?.trim() || process.env.AI_MODE?.trim() || "AI_MOCK"
);

const intentEnv = { ...commonEnv, AI_MODE: aiMode, /* optional OPENAI_*, BEDROCK_* from process.env */ };

const intentFn = new NodejsFunction(this, "IntentExtractFn", {
  ...lambdaDefaults,
  entry: path.join(__dirname, "..", "lambda", "intent-extract", "index.ts"),
  handler: "handler",
  environment: intentEnv,
  bundling: { ...lambdaDefaults.bundling, externalModules: [] },
});

const grantBedrockInvoke =
  aiMode === "BEDROCK" ||
  this.node.tryGetContext("grantBedrockInvoke") === true ||
  this.node.tryGetContext("grantBedrockInvoke") === "true";

if (grantBedrockInvoke) {
  intentFn.addToRolePolicy(/* bedrock:InvokeModel on foundation-model/* + inference-profile/* */);
}
```

**Snippet — shared Lambda defaults (query function still uses this shape):**

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
```

**Routes (same file):**

- **`POST /intent`** → **`intentFn`**
- **`POST /query/build`** → **`queryFn`**

**Outputs:** **`HttpApiUrl`**, **`Stage`**, plus (for the visualize Lambda) **`GrafanaMode`**, **`GrafanaBacking`**, **`GrafanaUrl`** — see the next section.

---

## Grafana visualization — who creates the dashboard?

**Files:** [`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts), [`lib/grafana-workspace-construct.ts`](./lib/grafana-workspace-construct.ts), [`lambda/grafana-visualize/`](./lambda/grafana-visualize/), [`docker/grafana/`](./docker/grafana/)

**Short answer:** the **CDK stack does not create the dashboard**. It only **points** the visualize Lambda at a dashboard **UID** (default **`ai-query-playground`**) that must already exist in the target Grafana. Dashboard creation is **out-of-band** and stage-specific.

### Responsibility split

| Layer | What it does | What it does **not** do |
| ----- | ------------ | ----------------------- |
| **CDK stack** (this repo) | Sets **`GRAFANA_DEFAULT_DASHBOARD_UID`** on **`GrafanaVisualizeFn`** (from **`humanQuery.grafana.defaultDashboardUid`** in [`cdk.json`](./cdk.json)). On non-local stages, optionally creates the AMG **workspace** via **`GrafanaWorkspaceConstruct`** (CfnWorkspace). | Never POSTs a dashboard JSON to any Grafana API. There is no `AWS::Grafana::Dashboard` CloudFormation resource. |
| **Local Grafana Docker** (`stage=local`) | **Creates the dashboard** by file provisioning. [`docker/grafana/provisioning/dashboards/dashboards.yaml`](./docker/grafana/provisioning/dashboards/dashboards.yaml) tells Grafana to import every JSON in [`docker/grafana/dashboards/`](./docker/grafana/dashboards/); the bundled [`ai-query-playground.json`](./docker/grafana/dashboards/ai-query-playground.json) defines the **`dynamicQuery`** *Textbox* template variable and panels whose expression is **`${dynamicQuery}`**. | Not a CDK / CloudFormation step — it happens inside the Grafana container on `npm run grafana:local:up`. |
| **AMG operator** (`stage=dev|test|prod`) | Authors the dashboard inside the AMG workspace **manually** (or via Grafana Terraform / custom-resource POST to `/api/dashboards/db`). The UID must match **`GRAFANA_DEFAULT_DASHBOARD_UID`** or callers must pass `dashboardUid` per request. | Workspace creation is automatable via [`GrafanaWorkspaceConstruct`](./lib/grafana-workspace-construct.ts), but dashboard contents are not part of `CfnWorkspace`. |

### Where the URL builder reads the UID

`buildVariableDashboardUrl` (in [`lambda/grafana-visualize/grafana-url.ts`](./lambda/grafana-visualize/grafana-url.ts)) only emits **`/d/<dashboardUid>?var-dynamicQuery=<encoded query>&from=...&to=...`** — there is no API call from the Lambda in the default `mode: "variable"` path. The target Grafana then substitutes **`${dynamicQuery}`** in the dashboard panel **at page-load** using the URL parameter (Grafana's template-variable URL-sync feature, governed by `skipUrlSync: false` on the variable). See [README.md — Grafana](./README.md#grafana--stage-aware-backing) and the worked example in [`code_generation_context_2.md`](./code_generation_context_2.md).

### Pointing at a different dashboard

- **Per request:** pass `"dashboardUid": "<uid>"` in the `POST /visualize` body.
- **Per environment:** change `humanQuery.grafana.defaultDashboardUid` in [`cdk.json`](./cdk.json) (or set `GRAFANA_DEFAULT_DASHBOARD_UID` env), then redeploy.

### Seeding the AMG dashboard later (optional)

Three realistic approaches when manual authoring becomes a bottleneck — **none of them via `CfnWorkspace`**:

1. **CDK custom resource** — Lambda-backed resource that does `POST /api/dashboards/db` to the AMG workspace at deploy time, using a service-account token from Secrets Manager. Reuse [`docker/grafana/dashboards/ai-query-playground.json`](./docker/grafana/dashboards/ai-query-playground.json) as the body.
2. **Grafana Terraform provider** (`grafana/grafana`) — run alongside CDK in CI; declarative dashboard / folder / data-source resources.
3. **Manual JSON import** — copy the same bundled dashboard JSON through the AMG console's *Dashboards → Import* in one click; useful for the first AMG deploy.

For the end-to-end IAM Identity Center → AMG group-to-role flow (independent of dashboard creation), see [`grafana-guide.md`](./grafana-guide.md).

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

## Intent Lambda (AI_MODE + X-Ray)

**Entry:** [`lambda/intent-extract/index.ts`](./lambda/intent-extract/index.ts) — reads **`process.env.AI_MODE`** via [`ai-mode.ts`](./lambda/intent-extract/ai-mode.ts) (**`AI_MOCK`** default; alias **`MOCK`** → mock).

| `AI_MODE` | Implementation | Required configuration |
| --------- | -------------- | ------------------------ |
| **`AI_MOCK`** | [`mock-extract.ts`](./lambda/intent-extract/mock-extract.ts) | None |
| **`OPENAI`** | [`openai-strategy.ts`](./lambda/intent-extract/openai-strategy.ts) | Lambda env **`OPENAI_API_KEY`** (set in console / Secrets Manager; never in CDK). Optional **`OPENAI_MODEL`**, **`OPENAI_API_BASE`**. |
| **`BEDROCK`** | [`bedrock-strategy.ts`](./lambda/intent-extract/bedrock-strategy.ts) | Lambda execution role **`bedrock:InvokeModel`** (CDK when **`aiMode=BEDROCK`** or **`-c grantBedrockInvoke=true`**). Optional **`BEDROCK_MODEL_ID`** (Anthropic Messages on Bedrock), **`BEDROCK_REGION`**. |

Shared prompt and post-conditions: [`intent-system-prompt.ts`](./lambda/intent-extract/intent-system-prompt.ts) (registry-aligned instructions), [`parse-model-intent.ts`](./lambda/intent-extract/parse-model-intent.ts) (JSON extract + **`validateIntentAgainstRegistry`**).

Operator-oriented summary: [README.md — AI_MODE](./README.md#ai_mode-intent-lambda).

- **Tests:** send **`{ "structuredIntent": { ... } }`** to bypass NL (**`mode: "passthrough"`**).
- **X-Ray:** **`AWSXRay.getSegment()?.addAnnotation(...)`** for **`handler`**, **`aiMode`**, **`domain`**, **`intent`** (domain/intent annotations added after NL extraction).

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

### Windows: “Starting the CLR failed” / PowerShell during bundling

See **[WINDOWS-CDK-BUNDLING.md](./WINDOWS-CDK-BUNDLING.md)**. Quick mitigations: **`npm run synth:local:docker`** with Docker Desktop running, or **`$env:CDK_FORCE_DOCKER_BUNDLING="1"`** before **`cdk synth`** / **`deploy:local`**.

---

## HTTP examples (curl)

Replace **`$API`** with **`HttpApiUrl`** from stack outputs.

**1) Natural language** (response includes **`mode`**: `ai_mock` / `openai` / `bedrock` when using NL)

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
- **Secrets:** store **`OPENAI_API_KEY`** in AWS Secrets Manager or SSM Parameter Store (encrypted) and resolve at runtime, or use a Lambda **environment variable** only for non-prod sandboxes — do not commit keys or pass them through **`cdk.json`**.
- **Bedrock:** scope **`bedrock:InvokeModel`** to specific foundation-model ARNs when you know the **`BEDROCK_MODEL_ID`**; the stack currently allows models in the stack region plus account inference profiles for faster iteration.
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
| **Bedrock NL → `StructuredQueryIntent`** (Anthropic Messages + registry validation) | Implemented: [`bedrock-strategy.ts`](./lambda/intent-extract/bedrock-strategy.ts), IAM in stack; optional **tool-use** / guardrails still future |

---

## Related reading

- [README.md](./README.md) — quick start, stages, API overview  
- [README-test.md](./README-test.md) — unit tests and Playwright E2E  
- [LOCALSTACK.md](./LOCALSTACK.md) — LocalStack deploy; **§ 5** includes **Grafana smoke test** (ingest logs + Explore + `/visualize`)  
- [WINDOWS-CDK-BUNDLING.md](./WINDOWS-CDK-BUNDLING.md) — Windows PowerShell / CLR failures during **`NodejsFunction`** bundling  
- [code_generation_context.md](./code_generation_context.md) — architecture intent and Grafana / X-Ray narrative  
