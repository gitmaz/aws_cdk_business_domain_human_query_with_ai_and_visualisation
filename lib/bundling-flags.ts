import type { Construct } from "constructs";

function envTruthy(name: string): boolean {
  const v = process.env[name];
  if (!v?.trim()) return false;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

function contextTruthy(scope: Construct, key: string): boolean {
  const v = scope.node.tryGetContext(key);
  if (v === true) return true;
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  return false;
}

/**
 * When true, **`NodejsFunction`** sets **`bundling.forceDockerBundling`** so esbuild runs inside the
 * CDK Lambda bundling image instead of **`powershell.exe` → `npx esbuild`** on Windows.
 *
 * Enable with either:
 * - **`CDK_FORCE_DOCKER_BUNDLING=1`** (or `true` / `yes` / `on`) in the environment, or
 * - CDK context **`useDockerBundling=true`** (CLI: **`-c useDockerBundling=true`**, or `cdk.json` context).
 *
 * Requires **Docker Desktop** (or compatible daemon) running.
 */
export function useDockerLambdaBundling(scope: Construct): boolean {
  return envTruthy("CDK_FORCE_DOCKER_BUNDLING") || contextTruthy(scope, "useDockerBundling");
}
