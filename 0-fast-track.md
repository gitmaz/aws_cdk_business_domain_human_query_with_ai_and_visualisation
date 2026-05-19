# Fast track — local human-query API + Grafana + SPA

Repo root for all commands below:

  maz\aws\serverless\aws_cdk_business_domain_human_query_with_ai_and_visualisation

---

## 1) LocalStack

Start (Python 3.12 + LocalStack CLI; see LOCALSTACK.md for variants):

  npm run localstack:start

**Windows:** If the CLI exits with `'charmap' codec can't encode character` (emoji in Docker banner), run once in the same shell before `npm run localstack:start`:

```powershell
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
```

Health:

  curl.exe -sS http://127.0.0.1:4566/_localstack/health

(There is no `npm run localstack:up` — use `localstack:start`.)

---

## 2) Local Grafana (optional but needed for real visualize / dashboard links)

  npm run grafana:local:up

---

## 3) Optional — put demo logs into LocalStack Logs

PowerShell (default region matches CDK / LocalStack scripts — override with `$env:CDK_DEFAULT_REGION` if needed):

```powershell
$ep     = "http://127.0.0.1:4566"
$region = "ap-southeast-2"
$lg     = "/aws/lambda/warehouse-service-demo"
$ls     = "demo-stream"
$env:AWS_ACCESS_KEY_ID     = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"

aws logs create-log-group   --log-group-name $lg --endpoint-url $ep --region $region 2>$null
aws logs create-log-stream  --log-group-name $lg --log-stream-name $ls --endpoint-url $ep --region $region 2>$null

$ts = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
aws logs put-log-events `
  --log-group-name $lg `
  --log-stream-name $ls `
  --log-events "timestamp=$ts,message=warehouse demo: inventory delay check SYD-1 latency=120ms" `
  --endpoint-url $ep `
  --region $region
```

On a **second** write to the same stream, add `--sequence-token <value>` from the previous command’s output (see LOCALSTACK.md under that block).

**Grafana Explore** (same log group) example:

```text
fields @timestamp, @message
| filter @message like /warehouse|SYD|delay/
| sort @timestamp desc
| limit 50
```

---

## 4) CDK — synth, deploy LocalStack, print API base URL

```powershell
cd maz\aws\serverless\aws_cdk_business_domain_human_query_with_ai_and_visualisation

# Fast synth (no SPA Lambda/S3 asset bundle):
$env:SPA_HOSTING = "none"
npm run synth:local

# Deploy stack to LocalStack:
npm run deploy:local

# Print HttpApiUrl for Playwright / SPA:
npm run playwright:print-env
```

Copy the printed **`PLAYWRIGHT_API_BASE_URL`** — that is the stack **`HttpApiUrl`** (base only; the SPA appends `/intent` and `/visualize`).

**Quick API smoke test** (replace `$api` with your printed URL; no trailing issues — use `curl.exe` on Windows):

```powershell
$api = "https://YOUR_ID.execute-api.localhost.localstack.cloud:4566/local/"
curl.exe -sS -X POST "$api/intent" -H "Content-Type: application/json" -d "{\"message\":\"show warehouse errors last hour\"}"
```

---

## 5) React SPA — local dev (FE + LocalStack BE)

1. Copy **`spa/.env.example`** → **`spa/.env.local`** (gitignored; share URLs with team outside git) — LocalStack **`HttpApiUrl`** from **`playwright:print-env`** after **`deploy:local`**.
2. **`npm run spa:dev`** → **http://localhost:3005/** (reads **`.env.local`** only; restart Vite after URL changes).

---

## 6) React SPA — build for AWS dev (Lambda static host)

When **`SPA_HOSTING=lambda`** (default), **`spa/dist` must exist** before synth/deploy (CDK copies it locally; no Docker). First time: deploy API only, set env, build SPA, redeploy.

1. **`$env:SPA_HOSTING = "none"`** → **`npm run deploy:dev`** → copy **`HttpApiUrl`** (and **`SwaggerDocsUrl`**).
2. Copy **`spa/.env.example`** → **`spa/.env.dev`** — **`VITE_API_BASE_URL`** = **`HttpApiUrl`** (not the SPA function URL).
3. **`npm run spa:build:dev`**
4. **`$env:SPA_HOSTING = "lambda"`** → **`npm run deploy:dev -- --require-approval never`**
5. Open **`SpaLambdaFunctionUrl`**. API calls use **`HttpApiUrl`**.

**CloudFront** (same build steps; AWS stages only):

```powershell
$env:SPA_HOSTING = "cloudfront"
npm run deploy:dev -- --require-approval never
# Open SpaCloudFrontUrl; VITE_API_BASE_URL still points at HttpApiUrl.
```

| Build script | Env file |
|--------------|----------|
| **`npm run spa:build:dev`** | **`.env.dev`** |
| **`npm run spa:build:test`** | **`.env.test`** |
| **`npm run spa:build:prod`** | **`.env.prod`** |

---

## Env / context reference

| Goal | Set |
|------|-----|
| Omit SPA infra in CDK | `$env:SPA_HOSTING = "none"` or `-c spaHosting=none` |
| Publish SPA to Lambda URL | `$env:SPA_HOSTING = "lambda"` (default) |
| Publish SPA to CloudFront + S3 | `$env:SPA_HOSTING = "cloudfront"` (AWS stages only; not `local`) |
| Publish SPA to S3 for EC2 sync | `$env:SPA_HOSTING = "ec2"` (+ see README **SPA hosting**) |

`SPA_HOSTING` overrides CDK context **`spaHosting`** when the env var is set.

@@extract swagger ui url
aws cloudformation describe-stacks --stack-name BusinessDomainHumanQuery-dev `
  --profile my-dev --region ap-southeast-2 `
  --query "Stacks[0].Outputs[?OutputKey=='SwaggerDocsUrl' || OutputKey=='SwaggerDocsLambdaUrl'].[OutputKey,OutputValue]" `
  --output table

@currenly result is:

api url:
https://0bkybqvnyc.execute-api.ap-southeast-2.amazonaws.com/docs

open specs:
 https://0bkybqvnyc.execute-api.ap-southeast-2.amazonaws.com/openapi.json

lambda url:
https://d4ylggygidffujmf3y5bkhjcsq0ozhkg.lambda-url.ap-southeast-2.on.aws/


@@sample build and deploy
npm run build; Remove-Item Env:SPA_HOSTING -ErrorAction SilentlyContinue; $env:AWS_PROFILE = "my-dev"; $env:AWS_REGION = "ap-southeast-2"; $env:CDK_DEFAULT_ACCOUNT = "154501673607"; $env:CDK_DEFAULT_REGION = "ap-southeast-2"; npm run deploy:dev -- --require-approval never
