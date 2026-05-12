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

The script sets dummy credentials, **`CDK_DEFAULT_ACCOUNT=000000000000`**, **`AWS_S3_FORCE_PATH_STYLE=1`**, and **`AWS_ENDPOINT_URL`** (default **`http://127.0.0.1:4566`**). Override **`AWS_ENDPOINT_URL`** if LocalStack listens elsewhere.

CDK CLI is invoked via **`npx -p aws-cdk@2.1121.0`** so LocalStack compatibility matches **`aws_cdk_invoice_processing_and_approval`**.

Stack name: **`BusinessDomainHumanQuery-local`**.

Outputs: **`HttpApiUrl`**, **`Stage`**.

Destroy:

```bash
npm run destroy:local
```

---

## 3) Environment variables (reference)

| Variable | Role |
| -------- | ---- |
| **`AWS_ENDPOINT_URL`** | LocalStack edge URL (default `http://127.0.0.1:4566`) |
| **`AWS_ACCESS_KEY_ID`** / **`AWS_SECRET_ACCESS_KEY`** | Defaults **`test`** / **`test`** in deploy script |
| **`CDK_DEFAULT_REGION`** | Region for bootstrap/deploy (default **`us-east-1`**) |
| **`AWS_S3_FORCE_PATH_STYLE`** | Set to **`1`** by deploy script for S3 compatibility |

From **another container** on Docker Desktop (Windows/macOS), point **`AWS_ENDPOINT_URL`** at **`http://host.docker.internal:4566`**.

---

## 4) Playwright E2E against LocalStack

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
