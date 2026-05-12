import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Destroy **`BusinessDomainHumanQuery-local`** on LocalStack.
 * Uses the same env as **`deploy-local-localstack.mjs`** (dummy keys, endpoint, optional profile strip).
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const stage = "local";
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

const defaultHostEndpoint = "http://127.0.0.1:4566";

function resolvedEndpoint() {
  return process.env.AWS_ENDPOINT_URL ?? defaultHostEndpoint;
}

function resolvedS3Endpoint() {
  return process.env.AWS_ENDPOINT_URL_S3 ?? resolvedEndpoint();
}

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
    CDK_DEFAULT_ACCOUNT: "000000000000",
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

function cdkArgs(base) {
  return verbose ? [...base, "--verbose"] : base;
}

function runStep(label, bin, args) {
  const fullArgs = cdkArgs(args);
  if (!isWin) {
    const r = spawnSync(bin, fullArgs, { cwd: repoRoot, env, stdio: "inherit", encoding: "utf8" });
    if (r.error || r.status === null || r.status !== 0) {
      console.error(`\n--- Destroy step failed: ${label} (exit ${r.status ?? -1}) ---`);
      process.exit(r.status ?? 1);
    }
    return;
  }
  const cmd = [bin, ...fullArgs].map((a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
  const r = spawnSync("cmd.exe", ["/d", "/s", "/c", cmd], { cwd: repoRoot, env, stdio: "inherit", encoding: "utf8" });
  if (r.error || r.status === null || r.status !== 0) {
    console.error(`\n--- Destroy step failed: ${label} (exit ${r.status ?? -1}) ---`);
    process.exit(r.status ?? 1);
  }
}

runStep("npm run build", "npm", ["run", "build"]);
runStep("cdk destroy", "npx", [
  "-p",
  "aws-cdk@2.1121.0",
  "cdk",
  "destroy",
  "--all",
  "-c",
  `stage=${stage}`,
  "--force",
]);

console.log("LocalStack destroy initiated/completed (stage=local).");
