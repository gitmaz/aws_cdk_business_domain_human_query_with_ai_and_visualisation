import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Deploy **`stage=local`** to LocalStack (CDK bootstrap + CDK deploy).
 * Bundled Lambdas (`NodejsFunction`) publish assets to LocalStack S3 — do not use `BootstraplessSynthesizer`.
 *
 * Override when LocalStack is not on the host default: **`AWS_ENDPOINT_URL`** (or **`DEPLOY_LOCAL_DOCKER_ENDPOINT`** in other docs).
 *
 * **Windows:** if **`cdk synth`** / deploy fails with PowerShell / CLR / esbuild errors, start Docker Desktop
 * and set **`CDK_FORCE_DOCKER_BUNDLING=1`** (or run **`npm run synth:local:docker`**) so bundling runs in a container.
 * See **WINDOWS-CDK-BUNDLING.md** in this repo.
 *
 * **Credentials:** dummy **`test`/`test`** keys are set. A host **`AWS_PROFILE`** (or session env vars) can still
 * make the AWS SDK / CDK talk to **real AWS** instead of LocalStack — they are stripped unless
 * **`CDK_LOCALSTACK_KEEP_AWS_PROFILE=1`** is set.
 *
 * **Debug:** **`DEPLOY_LOCAL_VERBOSE=1`** adds **`--verbose`** to CDK commands. Re-run and check the last error block.
 *
 * **Bootstrap:** set **`CDK_SKIP_BOOTSTRAP=1`** to skip **`cdk bootstrap`** when **`CDKToolkit`** already exists for **`000000000000`** in **`CDK_DEFAULT_REGION`** (faster retries / lower memory).
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cdkOutAbs = join(repoRoot, "cdk.out");

const stage = "local";
const account = "000000000000";
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

const defaultHostEndpoint = "http://127.0.0.1:4566";

function resolvedEndpoint() {
  return process.env.AWS_ENDPOINT_URL ?? defaultHostEndpoint;
}

function resolvedS3Endpoint() {
  return process.env.AWS_ENDPOINT_URL_S3 ?? resolvedEndpoint();
}

/** CDK synth/bootstrap/deploy can spike heap; merge so callers can still set NODE_OPTIONS. */
function nodeOptionsWithMinHeap() {
  const min = "--max-old-space-size=8192";
  const cur = (process.env.NODE_OPTIONS ?? "").trim();
  if (!cur) return min;
  if (/\bmax-old-space-size=\d+/.test(cur)) return cur;
  return `${cur} ${min}`;
}

function hostLocalstackEnv(endpoint) {
  const keepProfile = process.env.CDK_LOCALSTACK_KEEP_AWS_PROFILE === "1";
  const { AWS_PROFILE: _p, AWS_SESSION_TOKEN: _st, AWS_SECURITY_TOKEN: _sec, ...withoutProfile } = process.env;

  const base = keepProfile ? { ...process.env } : { ...withoutProfile };

  return {
    ...base,
    NODE_OPTIONS: nodeOptionsWithMinHeap(),
    ...(!keepProfile
      ? {
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
        }
      : {}),
    AWS_DEFAULT_REGION: region,
    CDK_DEFAULT_ACCOUNT: account,
    CDK_DEFAULT_REGION: region,
    AWS_ENDPOINT_URL: endpoint,
    AWS_ENDPOINT_URL_S3: resolvedS3Endpoint(),
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_USE_PATH_STYLE_ENDPOINT: "true",
    AWS_S3_FORCE_PATH_STYLE: "1",
  };
}

const ep = resolvedEndpoint();
const env = hostLocalstackEnv(ep);
const isWin = process.platform === "win32";
const verbose = process.env.DEPLOY_LOCAL_VERBOSE === "1";

function cdkExtraArgs() {
  return verbose ? ["--verbose"] : [];
}

/** Run a subprocess from repoRoot; on failure print hints (stdio inherits CDK output). */
function runStep(label, bin, args, { cdk = false } = {}) {
  const fullArgs = cdk ? [...args, ...cdkExtraArgs()] : [...args];
  if (!isWin) {
    const r = spawnSync(bin, fullArgs, { cwd: repoRoot, env, stdio: "inherit", encoding: "utf8" });
    if (r.error || r.status === null || r.status !== 0) {
      printFailureHints(label, `${bin} ${fullArgs.join(" ")}`, r.status ?? -1);
      process.exit(r.status ?? 1);
    }
    return;
  }
  const cmd = [bin, ...fullArgs].map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
  const r = spawnSync("cmd.exe", ["/d", "/s", "/c", cmd], { cwd: repoRoot, env, stdio: "inherit", encoding: "utf8" });
  if (r.error || r.status === null || r.status !== 0) {
    printFailureHints(label, cmd, r.status ?? -1);
    process.exit(r.status ?? 1);
  }
}

function printFailureHints(label, command, status) {
  console.error(`\n--- Deploy step failed: ${label} (exit ${status}) ---`);
  console.error(`Command: ${command}`);
  console.error("Hints:");
  console.error("  - Unset AWS_PROFILE / use a clean shell, or set CDK_LOCALSTACK_KEEP_AWS_PROFILE=1 only if you intend real-AWS profile.");
  console.error(`  - Set CDK_DEFAULT_REGION and AWS_DEFAULT_REGION to the same region as LocalStack (this script used: ${region}).`);
  console.error("  - Ensure LocalStack is up: curl http://127.0.0.1:4566/_localstack/health");
  console.error("  - Re-run with DEPLOY_LOCAL_VERBOSE=1 for CDK --verbose output.");
  console.error("  - Windows PowerShell/esbuild issues: see WINDOWS-CDK-BUNDLING.md (Docker bundling).");
  console.error("  - Retry bootstrap skipped: CDK_SKIP_BOOTSTRAP=1 (only if CDKToolkit already exists in this region).");
}

try {
  runStep("npm run build", "npm", ["run", "build"], { cdk: false });
  if (process.env.CDK_SKIP_BOOTSTRAP === "1") {
    console.log("Skipping cdk bootstrap (CDK_SKIP_BOOTSTRAP=1).");
  } else {
    runStep(
      "cdk bootstrap",
      "npx",
      ["-p", "aws-cdk@2.1121.0", "cdk", "bootstrap", `aws://${account}/${region}`, "-c", `stage=${stage}`],
      { cdk: true },
    );
  }
  /** One synth, then deploy from assembly — avoids bundling twice (lower RAM / faster on Windows). */
  runStep("cdk synth", "npx", ["-p", "aws-cdk@2.1121.0", "cdk", "synth", "-c", `stage=${stage}`], { cdk: true });
  runStep(
    "cdk deploy (from cdk.out)",
    "npx",
    [
      "-p",
      "aws-cdk@2.1121.0",
      "cdk",
      "deploy",
      "--all",
      "--app",
      cdkOutAbs,
      "--require-approval",
      "never",
    ],
    { cdk: true },
  );
} catch (e) {
  console.error(e);
  process.exit(1);
}

console.log("LocalStack deploy finished (stage=local).");
