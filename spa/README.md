# Human query SPA

Vite + React UI for **`POST /intent`** then **`POST /visualize`** (see project **`README.md`**). Shows **`grafana.dashboardUrl`** as an **Open in Grafana** link.

## Environment files

**Only `.env.example` is in git.** Copy it to gitignored files and fill in URLs (share those copies with the team out of band).

| Copy to (gitignored) | Used when |
| -------------------- | --------- |
| **`.env.local`** | **`npm run spa:dev`** — local FE + LocalStack API |
| **`.env.dev`** | **`npm run spa:build:dev`** |
| **`.env.test`** | **`npm run spa:build:test`** |
| **`.env.prod`** | **`npm run spa:build:prod`** |

Vite loads **`.env`**, then **`.env.local`**, then **`.env.[mode]`** (mode wins over `.env.local` for the same key). Stage builds use **`vite build --mode dev`**, so **`.env.dev`** overrides **`.env.local`** during **`spa:build:dev`**.

| Variable | Purpose |
| -------- | ------- |
| **`VITE_APP_STAGE`** | `local` → no OIDC wrapper, no `Authorization` header. Any other value → OIDC (`AuthProvider`) and Bearer token on API calls. |
| **`VITE_API_BASE_URL`** | Base URL of the HTTP API (not the SPA Lambda URL). |
| **`VITE_OIDC_*`** | Required when stage is not `local` (see **`.env.example`**). |

## Auth model

- **Local:** anonymous SPA and anonymous API calls (matches local Grafana without SSO). CORS must allow your dev origin (see stack CORS config).
- **Non-local:** browser **OIDC sign-in** (typical for org SSO). The SPA sends **`Authorization: Bearer <access_token>`** on `/intent` and `/visualize`. The HTTP API stack does **not** ship an API Gateway JWT authorizer by default.

## Scripts

From **`spa/`**: `npm run dev` (port **3005**), `npm run build:dev`, `npm run preview`.

From CDK project root:

| Script | Env file (build) |
| ------ | ---------------- |
| **`npm run spa:dev`** | **`.env.local`** (live Vite) |
| **`npm run spa:build:dev`** | **`.env.dev`** |
| **`npm run spa:build:test`** | **`.env.test`** |
| **`npm run spa:build:prod`** | **`.env.prod`** |
| **`npm run spa:build`** | same as **`spa:build:dev`** |

After **`spa:build:dev`**, deploy UI: **`SPA_USE_PREBUILT_DIST=1`**, **`SPA_HOSTING=lambda`**, **`npm run deploy:dev`**.
