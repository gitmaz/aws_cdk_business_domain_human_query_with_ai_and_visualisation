import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import openApiBase from "../../openapi/human-query.openapi.json";

const SWAGGER_UI_VERSION = "5.18.2";

const htmlPage = (openApiUrl: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Human Query API — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
  <style>body { margin: 0; } .topbar { display: none; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(openApiUrl)},
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout',
        tryItOutEnabled: true,
        persistAuthorization: true,
        displayRequestDuration: true,
      });
    };
  </script>
</body>
</html>`;

function htmlResponse(body: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    },
    body,
  };
}

function jsonResponse(body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify(body, null, 2),
  };
}

/** API Gateway v1 (REST) or v2 (HTTP) path. */
export function resolveRequestPath(event: APIGatewayProxyEventV2 & { path?: string }): string {
  const raw = event.rawPath ?? event.path ?? "/";
  const noQuery = raw.split("?")[0] ?? "/";
  return noQuery.replace(/\/+$/, "") || "/";
}

export function buildOpenApiDocument(apiPublicBaseUrl: string): Record<string, unknown> {
  const base = apiPublicBaseUrl.replace(/\/+$/, "") || "/";
  const doc = JSON.parse(JSON.stringify(openApiBase)) as Record<string, unknown>;
  doc.servers = [{ url: base, description: "Deployed API (Try it out targets these paths)" }];
  return doc;
}

/**
 * Serves Swagger UI HTML and OpenAPI JSON for the human-query HTTP API.
 * Hosted on the same API (`GET /docs`, `GET /openapi.json`) and optionally via Lambda Function URL.
 */
export const handler = async (
  event: APIGatewayProxyEventV2 & { path?: string },
): Promise<APIGatewayProxyResultV2> => {
  const path = resolveRequestPath(event);
  const apiBase = (process.env.API_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const openApiPath = "/openapi.json";

  if (path === openApiPath || path.endsWith(openApiPath)) {
    return jsonResponse(buildOpenApiDocument(apiBase));
  }

  if (path === "/" || path === "/docs" || path === "/docs/" || path.startsWith("/docs/")) {
    const openApiUrl = apiBase ? `${apiBase}${openApiPath}` : openApiPath;
    return htmlResponse(htmlPage(openApiUrl));
  }

  return {
    statusCode: 404,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
    body: JSON.stringify({
      error: "Not found",
      hint: "Use GET /docs for Swagger UI or GET /openapi.json for the OpenAPI document.",
    }),
  };
};
