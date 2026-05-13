import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

vi.mock("aws-xray-sdk-core", () => ({
  default: {
    getSegment: () => ({ addAnnotation: vi.fn() }),
  },
}));

import { handler } from "../lambda/grafana-visualize/index";

const demoEnv: Partial<NodeJS.ProcessEnv> = {
  DEFAULT_WAREHOUSE_LOG_GROUPS: "/aws/lambda/warehouse-service-demo",
  DEFAULT_MANUFACTURING_LOG_GROUPS: "",
  DEFAULT_FINANCE_LOG_GROUPS: "",
  DEFAULT_ORDERING_LOG_GROUPS: "",
  GRAFANA_DEFAULT_DASHBOARD_UID: "ops-dash",
  GRAFANA_DEFAULT_VARIABLE_NAME: "dynamicQuery",
  GRAFANA_DEFAULT_DATASOURCE_UID: "cloudwatch",
  GRAFANA_DEFAULT_REGION: "ap-southeast-2",
  GRAFANA_MODE: "MOCK",
};

function mkEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    requestContext: {} as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    version: "2.0",
    routeKey: "POST /visualize",
    rawPath: "/visualize",
    rawQueryString: "",
  };
}

describe("grafana-visualize handler (MOCK mode)", () => {
  beforeEach(() => {
    // Reset GRAFANA_* env between tests to avoid cross-pollination.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("GRAFANA_") || k.startsWith("DEFAULT_") || k === "STAGE") delete process.env[k];
    }
    Object.assign(process.env, demoEnv);
  });

  it("returns 400 when neither query nor structuredIntent provided", async () => {
    const res = await handler(mkEvent({}));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.error).toMatch(/query|structuredIntent/);
  });

  it("returns variable-driven dashboard URL for raw query", async () => {
    process.env.GRAFANA_URL = "https://g-abc.grafana-workspace.us-east-1.amazonaws.com";
    const res = await handler(
      mkEvent({
        query: "fields @timestamp, latency | stats avg(latency) by bin(5m)",
        timeRange: { value: 6, unit: "hour" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.grafana.mode).toBe("variable");
    expect(body.grafana.grafanaMode).toBe("MOCK");
    expect(body.grafana.dashboardUid).toBe("ops-dash");
    expect(body.grafana.variableName).toBe("dynamicQuery");
    expect(body.grafana.dashboardUrl).toContain("/d/ops-dash?");
    expect(body.grafana.dashboardUrl).toContain("var-dynamicQuery=");
    expect(body.grafana.dashboardUrl).toContain("from=now-6h");
    expect(body.grafana.timeRange).toEqual({ from: "now-6h", to: "now" });
    // No outbound fetch / no API key required → no renderBytes / no panelPatch.
    expect(body.grafana.renderBytesBase64).toBeUndefined();
    expect(body.grafana.panelPatch).toBeUndefined();
    expect(body.mockNote).toBeDefined();
  });

  it("falls back to MOCK when GRAFANA_URL is unset (even with mode=AWS)", async () => {
    process.env.GRAFANA_MODE = "AWS";
    delete process.env.GRAFANA_URL;
    const res = await handler(
      mkEvent({
        query: "fields @timestamp",
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.grafana.grafanaMode).toBe("MOCK");
  });

  it("builds query server-side from structuredIntent", async () => {
    process.env.GRAFANA_URL = "https://g.example.com";
    const res = await handler(
      mkEvent({
        structuredIntent: {
          domain: "warehouse",
          intent: "inventory_delay_analysis",
          entityFilters: { warehouseId: "WH-1" },
          timeRange: { value: 6, unit: "hour" },
          visualization: "timeseries",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.query).toContain("fields @timestamp");
    expect(body.builtQueries.logsInsightsQuery).toContain("fields @timestamp");
    expect(body.grafana.dashboardUrl).toContain("var-dynamicQuery=");
  });

  it("returns 400 when dashboardUid is unset (no default, no override)", async () => {
    delete process.env.GRAFANA_DEFAULT_DASHBOARD_UID;
    const res = await handler(mkEvent({ query: "fields @timestamp" }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(String(res.body));
    expect(body.error).toMatch(/dashboardUid/);
  });

  it("honors per-request dashboardUid + panelId + variableName + slug", async () => {
    process.env.GRAFANA_URL = "https://g.example.com";
    const res = await handler(
      mkEvent({
        query: "fields @timestamp",
        dashboardUid: "custom-dash",
        panelId: 7,
        variableName: "rawQuery",
        slug: "ops",
        variables: { region: "ap-southeast-2" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.grafana.dashboardUid).toBe("custom-dash");
    expect(body.grafana.variableName).toBe("rawQuery");
    expect(body.grafana.panelId).toBe(7);
    expect(body.grafana.panelEmbedUrl).toContain("/d-solo/custom-dash/ops?");
    expect(body.grafana.panelEmbedUrl).toContain("panelId=7");
    expect(body.grafana.dashboardUrl).toContain("var-rawQuery=");
    expect(body.grafana.dashboardUrl).toContain("var-region=ap-southeast-2");
  });

  it("returns renderUrl on render:true in MOCK mode (no bytes)", async () => {
    process.env.GRAFANA_URL = "https://g.example.com";
    const res = await handler(
      mkEvent({
        query: "fields @timestamp",
        panelId: 3,
        render: true,
        renderWidth: 800,
        renderHeight: 300,
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.grafana.renderUrl).toContain("/render/d-solo/ops-dash?");
    expect(body.grafana.renderUrl).toContain("panelId=3");
    expect(body.grafana.renderUrl).toContain("width=800");
    expect(body.grafana.renderBytesBase64).toBeUndefined();
  });

  it("auto-allows anonymous on STAGE=local when no API key is configured", async () => {
    /**
     * The CDK stack wires `GRAFANA_ALLOW_ANONYMOUS=1` for `stage=local` when no token is set,
     * but the config helper also auto-detects this from `STAGE=local` + missing key. This test
     * exercises the latter path to ensure `panel_patch` would not 503 in local Docker mode.
     */
    process.env.GRAFANA_URL = "http://host.docker.internal:3000";
    process.env.GRAFANA_MODE = "MOCK"; // keep handler short-circuited so we don't actually fetch
    process.env.STAGE = "local";
    const res = await handler(
      mkEvent({
        query: "fields @timestamp",
        panelId: 4,
        mode: "panel_patch",
      }),
    );
    /** MOCK short-circuit returns 200; absence of 503 = anonymous gate passed. */
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.grafana.mode).toBe("panel_patch");
    expect(body.grafana.grafanaMode).toBe("MOCK");
  });
});
