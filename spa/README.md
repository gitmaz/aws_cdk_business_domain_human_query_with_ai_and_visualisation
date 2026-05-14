# Human query SPA

Vite + React UI for **`POST /intent`** then **`POST /visualize`** (see project **`README.md`**). Shows **`grafana.dashboardUrl`** as an **Open in Grafana** link.

## Environment

Copy **`.env.example`** to **`.env.local`** and set **`VITE_API_BASE_URL`** to your stack **`HttpApiUrl`** (no trailing slash required; the app normalizes it).

| Variable | Purpose |
| -------- | ------- |
| **`VITE_APP_STAGE`** | `local` → no OIDC wrapper, no `Authorization` header. Any other value → OIDC (`AuthProvider`) and Bearer token on API calls. |
| **`VITE_API_BASE_URL`** | Base URL of the HTTP API (e.g. `https://abc.execute-api.../local` or regional URL). |
| **`VITE_OIDC_AUTHORITY`** | OIDC issuer URL (e.g. IAM Identity Center application issuer). Required when stage is not `local`. |
| **`VITE_OIDC_CLIENT_ID`** | Public OIDC client id. Required when stage is not `local`. |
| **`VITE_OIDC_REDIRECT_URI`** | Optional; defaults to current origin + pathname (must match IdP app callback URLs). |
| **`VITE_OIDC_SCOPE`** | Optional; default `openid profile email`. |

## Auth model

- **Local:** anonymous SPA and anonymous API calls (matches local Grafana without SSO). CORS must allow your dev origin (see stack CORS config).
- **Non-local:** browser **OIDC sign-in** (typical for org SSO). The SPA sends **`Authorization: Bearer <access_token>`** on `/intent` and `/visualize`. The HTTP API stack does **not** ship an API Gateway JWT authorizer by default; enforcing tokens is a separate infra step if you need it.

## Scripts

From **`spa/`**: `npm run dev` (port **3005**), `npm run build`, `npm run preview`.

From CDK project root: **`npm run spa:dev`**, **`npm run spa:build`**, **`npm run spa:preview`**.
