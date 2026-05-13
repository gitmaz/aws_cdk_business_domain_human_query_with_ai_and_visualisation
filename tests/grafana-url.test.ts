import { describe, expect, it } from "vitest";
import {
  buildRendererUrl,
  buildVariableDashboardUrl,
  timeRangeToGrafanaFromTo,
} from "../lambda/grafana-visualize/grafana-url";

describe("timeRangeToGrafanaFromTo", () => {
  it("defaults to 24h when no time range provided", () => {
    expect(timeRangeToGrafanaFromTo(undefined)).toEqual({ from: "now-24h", to: "now" });
  });

  it("maps hour/day/week to Grafana suffixes", () => {
    expect(timeRangeToGrafanaFromTo({ value: 6, unit: "hour" })).toEqual({ from: "now-6h", to: "now" });
    expect(timeRangeToGrafanaFromTo({ value: 3, unit: "day" })).toEqual({ from: "now-3d", to: "now" });
    expect(timeRangeToGrafanaFromTo({ value: 2, unit: "week" })).toEqual({ from: "now-2w", to: "now" });
  });

  it("falls back when value is invalid", () => {
    expect(timeRangeToGrafanaFromTo({ value: NaN as unknown as number, unit: "hour" })).toEqual({
      from: "now-24h",
      to: "now",
    });
  });
});

describe("buildVariableDashboardUrl", () => {
  it("builds /d/<uid> with var-<name> + time range", () => {
    const url = buildVariableDashboardUrl({
      grafanaUrl: "https://g-abc.grafana-workspace.us-east-1.amazonaws.com/",
      dashboardUid: "ops-dash",
      variableName: "dynamicQuery",
      query: "fields @timestamp, latency | stats avg(latency) by bin(5m)",
      timeRange: { value: 6, unit: "hour" },
      refresh: "30s",
    });

    expect(url.startsWith("https://g-abc.grafana-workspace.us-east-1.amazonaws.com/d/ops-dash?")).toBe(true);
    expect(url).toContain("from=now-6h");
    expect(url).toContain("to=now");
    expect(url).toContain("refresh=30s");
    // Variable value must be URL-encoded.
    expect(url).toContain("var-dynamicQuery=fields+%40timestamp");
    expect(url).toContain("bin%285m%29");
  });

  it("appends extra var-* template variables and slug", () => {
    const url = buildVariableDashboardUrl({
      grafanaUrl: "https://g.example.com",
      dashboardUid: "ops",
      variableName: "dynamicQuery",
      query: "fields @timestamp",
      variables: { region: "ap-southeast-2", env: "prod" },
      slug: "operations-overview",
    });
    expect(url).toContain("/d/ops/operations-overview?");
    expect(url).toContain("var-region=ap-southeast-2");
    expect(url).toContain("var-env=prod");
  });

  it("switches to /d-solo/<uid> when panelId is set", () => {
    const url = buildVariableDashboardUrl({
      grafanaUrl: "https://g.example.com",
      dashboardUid: "ops",
      variableName: "dynamicQuery",
      query: "fields @timestamp",
      panelId: 4,
    });
    expect(url).toContain("/d-solo/ops?");
    expect(url).toContain("panelId=4");
  });

  it("explicit from/to overrides timeRange", () => {
    const url = buildVariableDashboardUrl({
      grafanaUrl: "https://g.example.com",
      dashboardUid: "ops",
      variableName: "dynamicQuery",
      query: "fields @timestamp",
      timeRange: { value: 24, unit: "hour" },
      from: "now-15m",
      to: "now-1m",
    });
    expect(url).toContain("from=now-15m");
    expect(url).toContain("to=now-1m");
  });

  it("throws when required pieces are missing", () => {
    expect(() =>
      buildVariableDashboardUrl({
        grafanaUrl: "",
        dashboardUid: "ops",
        variableName: "dynamicQuery",
        query: "x",
      }),
    ).toThrow(/grafanaUrl/);

    expect(() =>
      buildVariableDashboardUrl({
        grafanaUrl: "https://g.example.com",
        dashboardUid: "",
        variableName: "dynamicQuery",
        query: "x",
      }),
    ).toThrow(/dashboardUid/);
  });
});

describe("buildRendererUrl", () => {
  it("builds /render/d-solo/<uid> with panelId + size", () => {
    const url = buildRendererUrl({
      grafanaUrl: "https://g.example.com/",
      dashboardUid: "ops",
      variableName: "dynamicQuery",
      query: "fields @timestamp",
      panelId: 3,
      width: 1000,
      height: 400,
      timeRange: { value: 1, unit: "hour" },
      orgId: 1,
      renderType: "png",
    });
    expect(url).toContain("/render/d-solo/ops?");
    expect(url).toContain("panelId=3");
    expect(url).toContain("width=1000");
    expect(url).toContain("height=400");
    expect(url).toContain("from=now-1h");
    expect(url).toContain("orgId=1");
    expect(url).not.toContain("type=png");
  });

  it("includes type when not png", () => {
    const url = buildRendererUrl({
      grafanaUrl: "https://g.example.com",
      dashboardUid: "ops",
      variableName: "dynamicQuery",
      query: "x",
      panelId: 1,
      width: 800,
      height: 400,
      renderType: "csv",
    });
    expect(url).toContain("type=csv");
  });
});
