import * as fs from "fs";
import * as path from "path";
import * as lambda from "aws-cdk-lib/aws-lambda";

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDirRecursive(from, to);
    else fs.copyFileSync(from, to);
  }
}

function spaBuildScript(stage: string): string {
  if (stage === "local") return "npm run spa:build:local";
  if (stage === "test") return "npm run spa:build:test";
  if (stage === "prod") return "npm run spa:build:prod";
  return "npm run spa:build:dev";
}

/**
 * Copy prebuilt `spa/dist` on the host. Throws if missing so CDK never falls back to Docker.
 */
export function spaPrebuiltLocalBundling(
  root: string,
  target: "lambda" | "s3",
  stage: string,
): { tryBundle(outputDir: string): boolean } {
  const buildCmd = spaBuildScript(stage);
  return {
    tryBundle(outputDir: string): boolean {
      const distDir = path.join(root, "spa", "dist");
      if (!fs.existsSync(distDir)) {
        throw new Error(
          `spa/dist is missing. Run ${buildCmd} (or set SPA_HOSTING=skip to omit SPA assets).`,
        );
      }
      try {
        if (target === "lambda") {
          copyDirRecursive(distDir, path.join(outputDir, "dist"));
          fs.copyFileSync(
            path.join(root, "lambda", "spa-static-host", "handler.cjs"),
            path.join(outputDir, "index.js"),
          );
        } else {
          copyDirRecursive(distDir, outputDir);
        }
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Failed to copy spa/dist into CDK asset output: ${msg}`);
      }
    },
  };
}

/** CDK asset bundling for SPA — local copy only (no Docker build step). */
export function spaAssetBundling(root: string, target: "lambda" | "s3", stage: string) {
  return {
    image: lambda.Runtime.NODEJS_20_X.bundlingImage,
    local: spaPrebuiltLocalBundling(root, target, stage),
    command: [],
  };
}
