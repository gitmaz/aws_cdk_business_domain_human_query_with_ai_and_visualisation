# Testing

This app has **no SPA** — contracts are two HTTP routes on API Gateway v2. Tests fall into:

| Track | Purpose | Command |
| ----- | ------- | ------- |
| **Unit (Vitest)** | Registry validation, query builders, Lambda handlers (X-Ray mocked for intent). **No AWS network calls.** | `npm test` |
| **E2E (Playwright)** | **`request`** calls against a **deployed** API base URL — use **LocalStack** (`stage=local`) or a real dev stack. | `npm run test:e2e` |

---

## 1. Unit tests (Vitest)

### Prerequisites

- **Node.js 20+** (matches `package.json` `engines`)

### Commands

```bash
npm install
npm test
npm run test:watch
```

### What is covered

| File | What it asserts |
| ---- | ---------------- |
| [`tests/domain-registry.test.ts`](./tests/domain-registry.test.ts) | Known domains, `validateIntentAgainstRegistry` accepts/rejects intents |
| [`tests/build-queries.test.ts`](./tests/build-queries.test.ts) | `buildQueriesForIntent` returns Logs Insights / X-Ray strings; invalid intent throws |
| [`tests/intent-extract.handler.test.ts`](./tests/intent-extract.handler.test.ts) | `POST /intent` handler: empty body → 400; passthrough `structuredIntent`; keyword routing |
| [`tests/query-dispatch.handler.test.ts`](./tests/query-dispatch.handler.test.ts) | `POST /query/build` handler: 200 with `builtQueries`; 400 when `domain` missing |

Config: [`vitest.config.ts`](./vitest.config.ts). [`tsconfig.json`](./tsconfig.json) excludes `tests/` and `e2e/` from `npm run build` (CDK TypeScript compile only).

---

## 2. E2E tests (Playwright + LocalStack)

E2E specs live under [`e2e/`](./e2e/). They use **`PLAYWRIGHT_API_BASE_URL`** (no trailing slash) — the same value as CDK output **`HttpApiUrl`**.

### A) Deploy to LocalStack

1. Start LocalStack (see **[LOCALSTACK.md](./LOCALSTACK.md)**).
2. From this directory:

```bash
npm run deploy:local
```

3. Set the API base for Playwright. Either copy **`HttpApiUrl`** from the deploy output, or:

```bash
npm run playwright:print-env
```

That script queries CloudFormation on LocalStack and prints PowerShell-friendly `PLAYWRIGHT_API_BASE_URL` lines (requires **`aws` CLI**).

### B) Install browser + run E2E

```bash
npm run test:e2e:install
$env:PLAYWRIGHT_API_BASE_URL = "<paste HttpApiUrl>"   # PowerShell
npm run test:e2e
```

**bash:**

```bash
export PLAYWRIGHT_API_BASE_URL=https://....amazonaws.com   # or LocalStack execute-api URL
npm run test:e2e
```

If **`PLAYWRIGHT_API_BASE_URL`** is unset, specs that need the API **skip** with a clear message.

### Optional env

See [`e2e/env.example`](./e2e/env.example). **`PLAYWRIGHT_CFN_STACK`** defaults to **`BusinessDomainHumanQuery-local`** for `playwright:print-env`.

---

## What is *not* automated here

- **Real AWS** full regression across accounts — use your CI with `CDK_DEFAULT_ACCOUNT` / profiles for `dev` / `test` / `prod` deploy smoke tests if needed.
- **CDK synth** as a test — run `npm run build && npm run synth -c stage=dev` locally when changing infra.

---

## Related docs

- [README.md](./README.md) — stages and deploy commands  
- [README-dev.md](./README-dev.md) — architecture and contracts  
- [LOCALSTACK.md](./LOCALSTACK.md) — LocalStack install and env vars for `deploy:local`
