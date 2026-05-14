import type { Construct } from "constructs";

export type SpaHostingMode = "lambda" | "ec2" | "none";

const VALID = new Set<SpaHostingMode>(["lambda", "ec2", "none"]);

/**
 * Where the built Vite SPA is published at deploy time.
 *
 * - **`SPA_HOSTING`** env (default **`lambda`**) or CDK context **`-c spaHosting=...`**
 * - Case-insensitive; **`none`** skips SPA infra (faster synth / CI without SPA bundle).
 */
export function resolveSpaHosting(scope: Construct): SpaHostingMode {
  const ctx = (scope.node.tryGetContext("spaHosting") as string | undefined)?.trim().toLowerCase();
  const env = process.env.SPA_HOSTING?.trim().toLowerCase();
  const raw = env || ctx || "lambda";
  if (!VALID.has(raw as SpaHostingMode)) {
    throw new Error(`Invalid SPA_HOSTING / spaHosting "${raw}". Use: lambda | ec2 | none`);
  }
  return raw as SpaHostingMode;
}

export function envTruthySpa(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
