# Local Grafana Docker (visualization layer for `stage=local`)

Real Grafana OSS container with **CloudWatch + X-Ray datasources provisioned against LocalStack**, used by the visualize Lambda when `stage=local`. There is **no** LocalStack-emulated Grafana — this is the actual upstream image with provisioning files mounted in.

See **[../../README.md § "Grafana — stage-aware backing"](../../README.md#grafana--stage-aware-backing)** for the full design (including AMG via `CfnWorkspace` for non-local stages) and **[../../LOCALSTACK.md § 5](../../LOCALSTACK.md#5-local-grafana-docker-visualization-layer)** for end-to-end verification.

## Layout

```
docker/grafana/
├── docker-compose.yml                              # Grafana + (profile: renderer) Image Renderer
├── grafana.ini                                     # anonymous Admin (local only), embed-friendly
├── dashboards/
│   └── ai-query-playground.json                    # ${dynamicQuery} template variable
└── provisioning/
    ├── datasources/datasources.yaml                # CloudWatch (uid=cloudwatch) + X-Ray (uid=xray)
    └── dashboards/dashboards.yaml                  # file provider → mounts ./dashboards
```

## Commands (run from the repo root)

```bash
npm run grafana:local:up                 # bring Grafana up on http://localhost:3000
npm run grafana:local:up:renderer        # + Grafana Image Renderer sidecar for render: true
npm run grafana:local:down               # stop (keeps the volume)
npm run grafana:local:down:purge         # stop + drop the persisted Grafana volume
```

After `up`, sanity-check from the host:

```bash
curl http://localhost:3000/api/health
```

## What gets provisioned

| Resource | UID / name | Notes |
| -------- | ---------- | ----- |
| CloudWatch datasource | `cloudwatch` (default) | `endpoint=http://host.docker.internal:4566`, region `us-east-1`, keys `test`/`test` |
| X-Ray datasource | `xray` | Same endpoint; plugin `grafana-x-ray-datasource` auto-installed via `GF_INSTALL_PLUGINS` |
| Dashboard | `ai-query-playground` | Two panels (timeseries + logs) bound to `${dynamicQuery}`; default time range `now-24h..now` |
| Template variable | `dynamicQuery` (Textbox) | Set by Lambda via URL: `?var-dynamicQuery=<encoded query>` |

UIDs match the AMG-side defaults (`cloudwatch`, `xray`) so the same Lambda `GRAFANA_DEFAULT_DATASOURCE_UID` env value works for both local Docker and AMG without per-stage tweaks.

## Networking

The compose file creates a bridge network named **`human-query-net`**. Two ways to make the LocalStack-deployed Lambda reach this Grafana:

- **Docker Desktop (Mac / Windows):** default works — the Lambda hits `http://host.docker.internal:3000`. Nothing extra to do.
- **Linux:** start LocalStack with **`LAMBDA_DOCKER_NETWORK=human-query-net`** so its Lambda containers join the same bridge, then point the stack at **`GRAFANA_URL=http://grafana:3000`**. Alternative: **`LAMBDA_DOCKER_FLAGS="--add-host host.docker.internal:host-gateway"`** keeps the default URL working.

The Grafana container itself uses `extra_hosts: ["host.docker.internal:host-gateway"]` so the CloudWatch / X-Ray datasources can reach LocalStack on the host on every platform.

## Authentication (local only)

`grafana.ini` enables anonymous **Admin** access for zero-friction local development:

```ini
[auth.anonymous]
enabled = true
org_role = Admin
```

The CDK stack auto-sets **`GRAFANA_ALLOW_ANONYMOUS=1`** on the visualize Lambda for `stage=local` when no `GRAFANA_API_KEY` is configured, so `panel_patch` and `render: true` requests do **not** require a Bearer token.

Do **not** replicate these settings on AMG — production uses a Grafana service-account token (env `GRAFANA_API_KEY` or Secrets Manager via `GRAFANA_API_KEY_SECRET_ARN`).

## Editing the dashboard

`dashboards.yaml` sets `allowUiUpdates: true` and `updateIntervalSeconds: 30`, so you can edit the panel in the Grafana UI and the JSON on disk is reloaded as long as the file path matches. Persisted Grafana DB lives in the named volume `grafana-data` — `npm run grafana:local:down:purge` wipes it.

If you tweak the dashboard JSON manually and want it picked up cleanly, run:

```bash
npm run grafana:local:down
npm run grafana:local:up
```

## Renderer (optional)

Enable the Image Renderer sidecar for server-side PNG rendering via `POST /visualize { render: true }`:

```bash
npm run grafana:local:up:renderer
# also set on the Lambda env (CDK context or env var):
GRAFANA_RENDERER_ENABLED=1 npm run deploy:local
```

The renderer joins `human-query-net` as `renderer:8081` and Grafana auto-discovers it. Disable by simply not setting the `renderer` profile.

## Not for production

Everything here (anonymous Admin, dummy keys, plaintext `grafana.ini`) is **local development only**. For `stage=dev|test|prod`, the CDK stack uses **Amazon Managed Grafana** — see the project README.
