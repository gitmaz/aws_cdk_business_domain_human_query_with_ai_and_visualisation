import type { Construct } from "constructs";

export type SpaHostingMode = "lambda" | "cloudfront" | "ec2" | "none";

const VALID = new Set<SpaHostingMode>(["lambda", "cloudfront", "ec2", "none"]);

/** @deprecated Use `none` — `skip` is accepted as an alias only. */
function normalizeSpaHostingInput(raw: string): string {
  if (raw === "skip") return "none";
  return raw;
}

/**
 * Where the built Vite SPA is published at deploy time.
 *
 * - **`lambda`** (default): Lambda function URL serves `spa/dist`.
 * - **`cloudfront`**: Private S3 origin + CloudFront (OAC).
 * - **`ec2`**: S3 artifact bucket for sync to an existing EC2/nginx host.
 * - **`none`**: CDK does not publish SPA assets (host yourself: Vite dev, etc.).
 *
 * Override via **`SPA_HOSTING`** env or CDK context **`-c spaHosting=...`**.
 */
export function resolveSpaHosting(scope: Construct): SpaHostingMode {
  const ctx = (scope.node.tryGetContext("spaHosting") as string | undefined)?.trim().toLowerCase();
  const env = process.env.SPA_HOSTING?.trim().toLowerCase();
  const raw = normalizeSpaHostingInput(env || ctx || "lambda");
  if (!VALID.has(raw as SpaHostingMode)) {
    throw new Error(`Invalid SPA_HOSTING / spaHosting "${env || ctx}". Use: lambda | cloudfront | ec2 | none`);
  }
  return raw as SpaHostingMode;
}
