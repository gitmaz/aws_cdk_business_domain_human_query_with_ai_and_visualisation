# LocalStack (`stage=local`)

Deploy the same CDK app as AWS, but with **context `stage=local`**: dummy account **`000000000000`**, path-style S3 for Lambda assets, and API Gateway + Lambda on LocalStack.

This stack is smaller than **`aws_cdk_invoice_processing_and_approval`** (no Cognito, DynamoDB, Step Functions, Textract). You only need LocalStack services that CDK touches for **`NodejsFunction`** + HTTP API: **S3** (assets), **CloudFormation**, **Lambda**, **API Gateway v2**, **IAM**, **Logs** (as supported by your LocalStack edition).

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

**Short answer:** LocalStack **Community** does expose **X-Ray–style APIs** locally (for example **`PutTraceSegments`**, **`GetTraceSummaries`**, **`BatchGetTraces`**) and the current Lambda implementation notes that the **X-Ray daemon is initialized** in the Lambda execution path — see [LocalStack X-Ray](https://docs.localstack.cloud/aws/services/xray/) and the Lambda provider notes in [LocalStack Lambda](https://docs.localstack.cloud/aws/services/lambda/). It is **not** a full clone of the AWS X-Ray control plane and console (for example, documented limitations around **correlating multiple segments** into one aggregated trace).

**For this project:** **`POST /intent`** and **`POST /query/build`** do **not** depend on traces for JSON responses; the handler only calls **`getSegment()?.addAnnotation(...)`** when a segment is present. So **Community is enough to exercise the APIs on LocalStack** even if trace quality or UI parity is lower than on AWS. For production-style trace validation, use a **real AWS** account or LocalStack’s paid tiers if you need stricter parity.

CDK CLI is invoked via **`npx -p aws-cdk@2.1121.0`** so LocalStack compatibility matches **`aws_cdk_invoice_processing_and_approval`**.

Stack name: **`BusinessDomainHumanQuery-local`**.

Outputs: **`HttpApiUrl`**, **`Stage`**.

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

Bring it up beside LocalStack:

```bash
npm run grafana:local:up                 # http://localhost:3000 (anonymous Admin)
npm run grafana:local:up:renderer        # + Grafana Image Renderer for `render: true`
npm run grafana:local:down               # stop
npm run grafana:local:down:purge         # stop + drop the persisted Grafana volume
```

Provisioned automatically (see `docker/grafana/`):

- **CloudWatch (LocalStack)** datasource — UID **`cloudwatch`** — endpoint `http://host.docker.internal:4566`, region `us-east-1`.
- **X-Ray (LocalStack)** datasource — UID **`xray`** — same endpoint (X-Ray plugin auto-installed via `GF_INSTALL_PLUGINS=grafana-x-ray-datasource`).
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

### Sanity check end-to-end (variable-driven)

```bash
npm run grafana:local:up
npm run deploy:local

# Replace <HttpApiUrl> with the LocalStack HTTP API base from the stack output:
curl -X POST <HttpApiUrl>/visualize \
  -H 'content-type: application/json' \
  -d '{
    "query": "fields @timestamp, @message | sort @timestamp desc | limit 20",
    "dashboardUid": "ai-query-playground"
  }'
```

The response includes `grafana.dashboardUrl` — open it in a browser to see the dashboard rendered against the LocalStack-backed CloudWatch datasource.

---

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
