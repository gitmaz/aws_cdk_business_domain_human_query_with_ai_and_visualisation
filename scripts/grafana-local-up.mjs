import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bring up the local Grafana Docker stack (Grafana + provisioned CloudWatch/X-Ray datasources
 * pointing at LocalStack). Used by `stage=local`.
 *
 * - `COMPOSE_PROFILES=renderer` also starts the Grafana Image Renderer sidecar for `render: true`.
 * - The Grafana endpoint is `http://localhost:3000` on the host and `http://grafana:3000` from any
 *   container attached to the `human-query-net` Docker network.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const composeDir = join(repoRoot, "docker", "grafana");
const composeFile = join(composeDir, "docker-compose.yml");

const args = ["compose", "-f", composeFile, "up", "-d"];
if (process.argv.includes("--renderer")) {
  process.env.COMPOSE_PROFILES = process.env.COMPOSE_PROFILES
    ? `${process.env.COMPOSE_PROFILES},renderer`
    : "renderer";
}

const isWin = process.platform === "win32";
const bin = isWin ? "docker.exe" : "docker";
const r = spawnSync(bin, args, { cwd: composeDir, stdio: "inherit", env: process.env });

if (r.error || (r.status ?? 1) !== 0) {
  console.error("\nFailed to start local Grafana stack.");
  console.error("Hints:");
  console.error("  - Docker Desktop must be running.");
  console.error("  - On Linux, make sure your user is in the `docker` group.");
  console.error("  - If port 3000 is taken, edit docker/grafana/docker-compose.yml.");
  process.exit(r.status ?? 1);
}

console.log("\nGrafana is starting at http://localhost:3000 (anonymous Admin).");
console.log("Health: curl http://localhost:3000/api/health");
console.log(
  "Lambda env wiring (stage=local): GRAFANA_URL=http://host.docker.internal:3000 (Docker Desktop) " +
    "or http://grafana:3000 (when LocalStack is on the human-query-net network).",
);
