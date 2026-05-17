import type { Construct } from "constructs";

export type SpaHostingMode = "lambda" | "ec2" | "skip";

const VALID = new Set<SpaHostingMode>(["lambda", "ec2", "skip"]);

/** @deprecated Use `skip` — `none` is accepted as an alias only. */
const SKIP_ALIASES = new Set(["none", "skip"]);

function normalizeSpaHostingInput(raw: string): string {
  if (SKIP_ALIASES.has(raw)) return "skip";
  return raw;
}

/**
 * Where the built Vite SPA is published at deploy time.
 *
 * - **`SPA_HOSTING`** env (default **`lambda`**) or CDK context **`-c spaHosting=...`**
 * - **`skip`**: CDK does not publish SPA assets (host yourself: Vite dev, S3, nginx, etc.)
 */
export function resolveSpaHosting(scope: Construct): SpaHostingMode {
  const ctx = (scope.node.tryGetContext("spaHosting") as string | undefined)?.trim().toLowerCase();
  const env = process.env.SPA_HOSTING?.trim().toLowerCase();
  const raw = normalizeSpaHostingInput(env || ctx || "lambda");
  if (!VALID.has(raw as SpaHostingMode)) {
    throw new Error(`Invalid SPA_HOSTING / spaHosting "${env || ctx}". Use: lambda | ec2 | skip`);
  }
  return raw as SpaHostingMode;
}
