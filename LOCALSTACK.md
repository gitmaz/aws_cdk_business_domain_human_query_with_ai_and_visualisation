# LocalStack (`stage=local`)

Deploy the same CDK app as AWS, but with **context `stage=local`**: dummy account **`000000000000`**, path-style S3 for Lambda assets, and API Gateway + Lambda on LocalStack.

This stack is smaller than **`aws_cdk_invoice_processing_and_approval`** (no Cognito, DynamoDB, Step Functions, Textract). For **`stage=local`**, CDK deploys a **REST API (API Gateway v1)** so invokes work on **LocalStack Community** (v2 HTTP APIs are often CFN fallbacks with no real `ApiId`). For **`dev` / `test` / `prod`**, the app still uses **HTTP API (v2)** on AWS. LocalStack needs **S3** (assets), **CloudFormation**, **Lambda**, **API Gateway (v1 for local)**, **IAM**, **Logs** (as supported by your LocalStack edition).

---

## 1) Install and start LocalStack

Follow the same pattern as the invoice repo: **LocalStack CLI + Docker** (image tag **`localstack:4.12`** is a known-good baseline in sibling projects).

```bash
py -3.12 -m localstack.cli.main start -d -s localstack:4.12
```

Sanity check:

```bash
curl http://127.0.0.1:4566/_localstack/health
```

**Windows:** if the CLI errors on encoding, set **`PYTHONUTF8=1`** and **`PYTHONIOENCODING=utf-8`**, then retry.

---

## 2) Deploy from the repo host

From this project directory (so `npm run build` sees `bin/` and `lib/`):

```bash
npm install
npm run deploy:local
```

**What `deploy:local` runs:** **`npm run build`** → **`cdk bootstrap`** (omit with **`CDK_SKIP_BOOTSTRAP=1`** if **`CDKToolkit`** already exists) → **`cdk synth -c stage=local`** → **`cdk deploy --all --app <absolute>/cdk.out`** so Lambda assets are built once, then published to LocalStack S3.

The script sets dummy credentials, **`CDK_DEFAULT_ACCOUNT=000000000000`**, **`AWS_S3_FORCE_PATH_STYLE=1`**, and **`AWS_ENDPOINT_URL`** (default **`http://127.0.0.1:4566`**). Override **`AWS_ENDPOINT_URL`** if LocalStack listens elsewhere.

**`AWS_PROFILE`:** the deploy script **drops** `AWS_PROFILE`, `AWS_SESSION_TOKEN`, and `AWS_SECURITY_TOKEN` by default so calls go to LocalStack with **`test`/`test`** keys. If you truly need a profile in the chain, set **`CDK_LOCALSTACK_KEEP_AWS_PROFILE=1`** (unusual for LocalStack).

**`cdk deploy` fails with exit code 1:** run with **`DEPLOY_LOCAL_VERBOSE=1`** so CDK adds **`--verbose`**, then read the last CloudFormation / asset error in the log. Align **`CDK_DEFAULT_REGION`** / **`AWS_DEFAULT_REGION`** with the region where LocalStack created **`CDKToolkit`** (often **`us-east-1`**).

### X-Ray on LocalStack Community (no login)

This stack sets Lambda **`Tracing.ACTIVE`** (CDK adds **`xray:PutTraceSegments`** / **`PutTelemetryRecords`**) and the intent Lambda uses **`aws-xray-sdk-core`** for annotations when a segment exists.

**Important (LocalStack 4.x Community, unauthenticated “latest community” image):** the **`/_localstack/health`** JSON often **does not list `xray`**, and **`aws xray put-trace-segments --endpoint-url http://127.0.0.1:4566`** may return **`InternalFailure`** with a message like *“The API for service `xray` is either not included in your current license plan or has not yet been emulated by LocalStack.”* That means **your running LocalStack build is not serving the X-Ray control-plane API on your plan**, not merely “health forgot a key.” Do **not** rely on Grafana’s **X-Ray (LocalStack)** datasource in `docker/grafana/` against that instance until X-Ray is actually accepted (e.g. a **licensed / Pro-capable** LocalStack image and auth, or **real AWS** for X-Ray).

**For this project:** **`POST /intent`** and **`POST /query/build`** do **not** depend on X-Ray for JSON responses; the handler only calls **`getSegment()?.addAnnotation(...)`** when a segment exists. **Local Grafana smoke tests** in **[§ 5](#5-local-grafana-docker-visualization-layer)** use **CloudWatch Logs** only — that path matches **`"logs": "available"`** in health and works on Community. For **production-style** X-Ray + Grafana, use a **real AWS** account (or a LocalStack edition that documents X-Ray as included for your license).

See also [LocalStack X-Ray](https://docs.localstack.cloud/aws/services/xray/) and [feature coverage / licensing](https://docs.localstack.cloud/references/coverage/) for your exact version.

CDK CLI is invoked via **`npx -p aws-cdk@2.1121.0`** so LocalStack compatibility matches **`aws_cdk_invoice_processing_and_approval`**.

Stack name: **`BusinessDomainHumanQuery-local`**.

Outputs: **`HttpApiUrl`** (REST stage invoke URL for **`local`**; HTTP API base URL on other stages), **`Stage`**.

Destroy:

```bash
npm run destroy:local
```

**`destroy:local`** uses the same LocalStack env helpers as **`deploy:local`** (dummy keys, **`AWS_PROFILE`** stripped, **`NODE_OPTIONS`** heap bump). Use **`DEPLOY_LOCAL_VERBOSE=1`** here too for **`cdk destroy --verbose`**.

---

## 3) Troubleshooting deploy / destroy

| Symptom | What to try |
| ------- | ----------- |
| **`cdk deploy` exits 1** with no obvious line in the terminal | **`DEPLOY_LOCAL_VERBOSE=1 npm run deploy:local`** — CDK prints CloudFormation and asset steps. |
| **`cdk bootstrap` OOM / very slow** on Windows | **`CDK_SKIP_BOOTSTRAP=1`** if **`CDKToolkit`** already exists for **`000000000000`** in **`CDK_DEFAULT_REGION`** (check with `aws cloudformation describe-stacks --stack-name CDKToolkit --endpoint-url …`). |
| Calls hit **real AWS** instead of LocalStack | Open a shell **without** **`AWS_PROFILE`** / SSO session vars, or set **`CDK_LOCALSTACK_KEEP_AWS_PROFILE=1`** only if you intentionally use a profile **and** still point APIs at LocalStack. |
| **Region mismatch** (bootstrap in `us-east-1`, deploy elsewhere) | Set **`CDK_DEFAULT_REGION`** and **`AWS_DEFAULT_REGION`** to the same value before **`npm run deploy:local`**. |
| **Stale / corrupt `cdk.out`** after a failed deploy | Delete the **`cdk.out`** folder in the repo root, then **`npm run deploy:local`** again. |
| **Grafana Explore / dashboard:** **`StartQuery` … `'NoneType' object is not iterable`** (HTTP 500 from LocalStack) | **Cause:** LocalStack’s Moto **`StartQuery`** only reads **`logGroupName`** / **`logGroupNames`**. **Grafana 11.x** often sends **`logGroupIdentifiers`** for Logs Insights; Moto ignores them → **`logGroupNames`** is null → crash ([LocalStack #12185](https://github.com/localstack/localstack/issues/12185)). **Fix:** this repo’s **`docker-compose.yml`** pins **`grafana/grafana-oss:12.4.0`**, where non–monitoring-account CloudWatch datasources use **`logGroupNames`** again ([Grafana #113137](https://github.com/grafana/grafana/pull/113137)). Run **`docker compose pull`** in **`docker/grafana/`**, then **`npm run grafana:local:down:purge`** and **`npm run grafana:local:up`**. The **`ai-query-playground`** JSON still sets **`logGroupNames`** for clarity. In **Explore**, pick the log group before **Run query**. |

---

## 4) Environment variables (reference)

| Variable | Role |
| -------- | ---- |
| **`AWS_ENDPOINT_URL`** | LocalStack edge URL (default `http://127.0.0.1:4566`) |
| **`AWS_ACCESS_KEY_ID`** / **`AWS_SECRET_ACCESS_KEY`** | Defaults **`test`** / **`test`** in deploy/destroy scripts |
| **`CDK_DEFAULT_REGION`** | Region for bootstrap/deploy/destroy (default **`us-east-1`**) |
| **`AWS_S3_FORCE_PATH_STYLE`** | Set to **`1`** by deploy script for S3 compatibility |
| **`DEPLOY_LOCAL_VERBOSE`** | Set to **`1`** to add **`--verbose`** to CDK commands in **`deploy:local`** and **`destroy:local`**. |
| **`CDK_SKIP_BOOTSTRAP`** | Set to **`1`** in **`deploy:local`** only to skip **`cdk bootstrap`** when **`CDKToolkit`** is already present. |
| **`CDK_FORCE_DOCKER_BUNDLING`** | Set to **`1`** / **`true`** so **`NodejsFunction`** bundles inside Docker (Windows PowerShell/esbuild issues); see **`WINDOWS-CDK-BUNDLING.md`**. |
| **`CDK_LOCALSTACK_KEEP_AWS_PROFILE`** | Set to **`1`** to **not** strip **`AWS_PROFILE`** / session tokens (advanced; default strips them for LocalStack). |

From **another container** on Docker Desktop (Windows/macOS), point **`AWS_ENDPOINT_URL`** at **`http://host.docker.internal:4566`**.

---

## 5) Local Grafana Docker (visualization layer)

`POST /visualize` (see **[README.md § "Grafana — stage-aware backing"](./README.md#grafana--stage-aware-backing)**) is wired by the CDK stack to a **local Grafana Docker** when `stage=local`. It is **not** a LocalStack-emulated Grafana — it is a real Grafana OSS container with **CloudWatch + X-Ray datasources provisioned against LocalStack** (`http://host.docker.internal:4566`, dummy `test`/`test` keys).

Bring it up beside LocalStack (**Grafana OSS 12.4.x** — avoids **`StartQuery` / `logGroupIdentifiers`** issues with LocalStack Moto; see **§ 3** troubleshooting row):

```bash
npm run grafana:local:up                 # http://localhost:3000 (anonymous Admin)
npm run grafana:local:up:renderer        # + Grafana Image Renderer for `render: true`
npm run grafana:local:down               # stop
npm run grafana:local:down:purge         # stop + drop the persisted Grafana volume
```

Provisioned automatically (see `docker/grafana/`):

- **CloudWatch (LocalStack)** datasource — UID **`cloudwatch`** — endpoint `http://host.docker.internal:4566`, region `us-east-1`.
- **X-Ray (LocalStack)** datasource — UID **`xray`** — same endpoint (X-Ray plugin auto-installed via `GF_INSTALL_PLUGINS=grafana-x-ray-datasource`). **May not work** on plain **Community** if LocalStack rejects **`xray`** APIs (see [§ 2 — X-Ray on LocalStack Community](#x-ray-on-localstack-community-no-login)); use **CloudWatch** for smoke tests until X-Ray is enabled on your LocalStack edition.
- Dashboard **`ai-query-playground`** with a **`dynamicQuery`** Textbox template variable; panels' CloudWatch Logs Insights expression is **`${dynamicQuery}`** so the variable-driven URL from `/visualize` Just Works.

### Networking — Lambda ↔ Grafana

The CDK stack defaults `GRAFANA_URL=http://host.docker.internal:3000` for `stage=local`. Reachability of that URL from the **LocalStack Lambda container** varies by platform:

| Platform | Default Just Works? | If not, options |
| -------- | ------------------- | --------------- |
| **Docker Desktop** (Mac / Windows) | **Yes** — `host.docker.internal` is auto-mapped inside LocalStack Lambda containers. | — |
| **Linux** | **No** — host gateway alias is not added by default. | (1) **Shared bridge:** start LocalStack with **`LAMBDA_DOCKER_NETWORK=human-query-net`** (the network is created by `docker compose up`) and set **`GRAFANA_URL=http://grafana:3000`**.<br/>(2) **Host gateway flag:** start LocalStack with **`LAMBDA_DOCKER_FLAGS="--add-host host.docker.internal:host-gateway"`** and keep the default URL. |

Quick verification after `npm run grafana:local:up`:

```bash
# from host:
curl http://localhost:3000/api/health
# inside any container on human-query-net:
docker run --rm --network human-query-net curlimages/curl -s http://grafana:3000/api/health
```

### Authentication on local Docker Grafana

The bundled `grafana.ini` enables **anonymous Admin** (`GF_AUTH_ANONYMOUS_ENABLED=true` + `GF_AUTH_ANONYMOUS_ORG_ROLE=Admin`). This is **local development only** — never replicate on AMG. The CDK stack auto-sets **`GRAFANA_ALLOW_ANONYMOUS=1`** on the visualize Lambda for `stage=local` when no `GRAFANA_API_KEY` is configured, so `panel_patch` and `render: true` requests do not require a service-account token.

### Stack outputs after `npm run deploy:local`

| Output | Local default value |
| ------ | ------------------- |
| **`GrafanaMode`** | **`AWS`** (real HTTP) when Grafana Docker is reachable; **`MOCK`** if `GRAFANA_URL` is empty |
| **`GrafanaBacking`** | **`local-docker`** |
| **`GrafanaUrl`** | **`http://host.docker.internal:3000`** (or operator override) |
| **`HttpApiUrl`** | LocalStack HTTP API base — `POST /visualize` lives here |

### Grafana smoke test (LocalStack + sample logs)

**Goal:** confirm Grafana’s **CloudWatch (LocalStack)** datasource can run **Logs Insights** against log data that exists only in LocalStack (not AWS).

**Prerequisites**

1. LocalStack is up — **`curl http://127.0.0.1:4566/_localstack/health`** (see [§ 1](#1-install-and-start-localstack)).
2. **`npm run grafana:local:up`** — Grafana at **http://localhost:3000** (anonymous Admin).
3. Use region **`us-east-1`** for CLI and queries (matches [`docker/grafana/provisioning/datasources/datasources.yaml`](./docker/grafana/provisioning/datasources/datasources.yaml)).

#### 1) Put sample events into LocalStack CloudWatch Logs

Use the same demo log group name as **`cdk.json`** → **`/aws/lambda/warehouse-service-demo`**.

**PowerShell (Windows)**

```powershell
$ep = "http://127.0.0.1:4566"
$region = "us-east-1"
$lg = "/aws/lambda/warehouse-service-demo"
$ls = "demo-stream"
$env:AWS_ACCESS_KEY_ID = "test"
$env:AWS_SECRET_ACCESS_KEY = "test"

aws logs create-log-group --log-group-name $lg --endpoint-url $ep --region $region 2>$null
aws logs create-log-stream --log-group-name $lg --log-stream-name $ls --endpoint-url $ep --region $region 2>$null

$ts = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$body = '{"logEvents":[{"timestamp":' + $ts + ',"message":"warehouse demo: inventory delay check SYD-1 latency=120ms"}]}'
aws logs put-log-events --log-group-name $lg --log-stream-name $ls --cli-input-json $body --endpoint-url $ep --region $region
```

If **`put-log-events`** fails on a **second** write to the same stream, pass **`--sequence-token`** from the previous command’s output.

**Bash**

```bash
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
EP=http://127.0.0.1:4566
R=us-east-1
LG=/aws/lambda/warehouse-service-demo
LS=demo-stream

aws logs create-log-group --log-group-name "$LG" --endpoint-url "$EP" --region "$R" 2>/dev/null || true
aws logs create-log-stream --log-group-name "$LG" --log-stream-name "$LS" --endpoint-url "$EP" --region "$R" 2>/dev/null || true
TS=$(($(date +%s) * 1000))
aws logs put-log-events --log-group-name "$LG" --log-stream-name "$LS" \
  --log-events "timestamp=${TS},message=warehouse demo: inventory delay SYD-1 latency=120ms" \
  --endpoint-url "$EP" --region "$R"
```

#### 2) Verify in Grafana — Explore (fastest)

1. Open **http://localhost:3000** → **Explore**.
2. Data source: **CloudWatch (LocalStack)**.
3. Query mode: **CloudWatch Logs** · Region: **`us-east-1`**.
4. Log groups: select **`/aws/lambda/warehouse-service-demo`** (or type it if shown).
5. Run:

```sql
fields @timestamp, @message
| filter @message like /warehouse|delay|SYD/
| sort @timestamp desc
| limit 20
```

You should see the line ingested via **`put-log-events`**.

#### 3) Verify on the bundled dashboard — **AI Query Playground**

The dashboard **`ai-query-playground`** provisions both panels with **`logGroupNames`**: `["/aws/lambda/warehouse-service-demo"]` (legacy field shape) so Grafana’s **`StartQuery`** request includes **`logGroupNames`**, which LocalStack’s Moto layer accepts. Do **not** rely on structured **`logGroups`** (ARN list) for this dashboard on LocalStack — Grafana maps those to **`logGroupIdentifiers`**, which Moto does not handle. Set the **`dynamicQuery`** textbox to a Logs Insights expression (no **`SOURCE …`** line required for that default group), for example:

```sql
fields @timestamp, @message
| filter @message like /warehouse|delay|SYD/
| sort @timestamp desc
| limit 20
```

If you point panels at **other** log groups, either add them under **Panel → Query options → Log groups** in the UI or embed the group in the query:

```sql
SOURCE '/aws/lambda/other-log-group'
| fields @timestamp, @message
| sort @timestamp desc
| limit 20
```

Paste into **`dynamicQuery`**, or open a URL with **`?var-dynamicQuery=<URL-encoded query>`** (the **`POST /visualize`** response builds this for you).

**After changing `docker/grafana/dashboards/*.json` on disk**, restart the stack so Grafana reloads the file provider: **`npm run grafana:local:down`** then **`npm run grafana:local:up`**, or use **`npm run grafana:local:down:purge`** if the DB still holds an old copy of the dashboard (or wait for **`updateIntervalSeconds`** if you only edited via UI and the path matches).

#### 4) Optional — smoke test `POST /visualize` after stack deploy

```bash
npm run deploy:local
```

Replace **`<HttpApiUrl>`** with the **`HttpApiUrl`** stack output (same base you use for **`/intent`**).

```bash
curl -sS -X POST "<HttpApiUrl>/visualize" \
  -H "content-type: application/json" \
  -d "{\"query\":\"SOURCE '/aws/lambda/warehouse-service-demo' | fields @timestamp, @message | sort @timestamp desc | limit 20\",\"dashboardUid\":\"ai-query-playground\"}"
```

**PowerShell** (escape double quotes inside the JSON):

```powershell
$api = "<HttpApiUrl>"
$body = '{"query":"SOURCE ''/aws/lambda/warehouse-service-demo'' | fields @timestamp, @message | sort @timestamp desc | limit 20","dashboardUid":"ai-query-playground"}'
Invoke-RestMethod -Method Post -Uri "$api/visualize" -ContentType "application/json" -Body $body
```

Open **`grafana.dashboardUrl`** from the JSON response in a browser (variable-driven URL; default **`mode: "variable"`** does not call Grafana from the Lambda).

#### Smoke test troubleshooting

| Symptom | What to check |
| ------- | ------------- |
| **No rows in Grafana** | Log group name matches **`SOURCE '...'`**; region **`us-east-1`**; Grafana time range includes “now”; LocalStack actually received **`put-log-events`** (re-run CLI, check for errors). |
| **Grafana cannot reach LocalStack** | LocalStack on **host** at **`127.0.0.1:4566`**; Grafana container uses **`host.docker.internal:4566`** (Docker Desktop). On **Linux**, see [Networking — Lambda ↔ Grafana](#networking--lambda--grafana) (shared **`human-query-net`** or **`host-gateway`**). |
| **Insights errors in Grafana** | LocalStack Community parity is not identical to AWS — try a minimal query first: **`fields @timestamp, @message \| limit 5`**. Upgrade LocalStack or check [LocalStack CloudWatch docs](https://docs.localstack.cloud/aws/services/cloudwatch/) for your version. |
| **`/visualize` returns a URL but browser shows empty panels** | Default textbox query has no **`SOURCE`** — use the **`SOURCE '...'`** query above or select log groups in the panel and save. |
| **`aws xray …` returns `InternalFailure` (not in license plan / not emulated)** | Your LocalStack image **does not expose the X-Ray API** on your current plan. **Grafana X-Ray panels** against LocalStack will fail too — use **CloudWatch Logs** for local smoke tests; use **real AWS** or a LocalStack edition that includes X-Ray for your license. See [§ 2 — X-Ray on LocalStack Community](#x-ray-on-localstack-community-no-login). |

## 6) Playwright E2E against LocalStack

After deploy:

```bash
npm run playwright:print-env
```

Paste the printed **`PLAYWRIGHT_API_BASE_URL`**, then:

```bash
npm run test:e2e:install
npm run test:e2e
```

Details: **[README-test.md](./README-test.md)**.

---

## Related

- [README.md](./README.md) — all stages (`local`, `dev`, `test`, `prod`)  
- [README-test.md](./README-test.md) — unit + E2E commands
