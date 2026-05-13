import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tear down the local Grafana Docker stack. `--volumes` also removes the persisted Grafana DB.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const composeDir = join(repoRoot, "docker", "grafana");
const composeFile = join(composeDir, "docker-compose.yml");

const args = ["compose", "-f", composeFile, "down"];
if (process.argv.includes("--volumes")) args.push("--volumes");

const isWin = process.platform === "win32";
const bin = isWin ? "docker.exe" : "docker";
const r = spawnSync(bin, args, { cwd: composeDir, stdio: "inherit", env: process.env });

if (r.error || (r.status ?? 1) !== 0) {
  console.error("\nFailed to stop local Grafana stack.");
  process.exit(r.status ?? 1);
}
console.log("\nGrafana stack stopped.");
