import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import {
  GrafanaWorkspaceConstruct,
  type GrafanaContext,
} from "../lib/grafana-workspace-construct";

function mkStack(): Stack {
  const app = new App();
  return new Stack(app, "TestStack", { env: { account: "111111111111", region: "us-east-1" } });
}

describe("GrafanaWorkspaceConstruct", () => {
  it("stage=local defaults to local Docker URL (no CfnWorkspace)", () => {
    const stack = mkStack();
    const c = new GrafanaWorkspaceConstruct(stack, "Grafana", {
      stage: "local",
      context: undefined,
    });
    expect(c.backing).toBe("local-docker");
    expect(c.endpoint).toBe("http://host.docker.internal:3000");
    expect(c.workspace).toBeUndefined();

    const t = Template.fromStack(stack);
    expect(t.resourceCountIs("AWS::Grafana::Workspace", 0));
  });

  it("stage=local honours local.url context override", () => {
    const stack = mkStack();
    const ctx: GrafanaContext = { local: { url: "http://grafana:3000" } };
    const c = new GrafanaWorkspaceConstruct(stack, "Grafana", { stage: "local", context: ctx });
    expect(c.backing).toBe("local-docker");
    expect(c.endpoint).toBe("http://grafana:3000");
  });

  it("operator-provided GRAFANA_URL wins on any stage", () => {
    const stack = mkStack();
    const c = new GrafanaWorkspaceConstruct(stack, "Grafana", {
      stage: "dev",
      context: undefined,
      envUrl: "https://my.amg.example",
    });
    expect(c.backing).toBe("amg-existing");
    expect(c.endpoint).toBe("https://my.amg.example");
    expect(c.workspace).toBeUndefined();
  });

  it("operator-provided url wins on stage=local too (real AMG from LocalStack)", () => {
    const stack = mkStack();
    const c = new GrafanaWorkspaceConstruct(stack, "Grafana", {
      stage: "local",
      context: { url: "https://my.amg.example" },
    });
    expect(c.backing).toBe("local-docker");
    expect(c.endpoint).toBe("https://my.amg.example");
  });

  it("stage=dev with createWorkspace=true creates AMG CfnWorkspace and wires endpoint", () => {
    const stack = mkStack();
    const c = new GrafanaWorkspaceConstruct(stack, "Grafana", {
      stage: "dev",
      context: { aws: { createWorkspace: true, workspaceName: "human-query-dev" } },
    });
    expect(c.backing).toBe("amg-created");
    expect(c.workspace).toBeDefined();
    expect(c.endpoint.startsWith("https://")).toBe(true);

    const t = Template.fromStack(stack);
    t.resourceCountIs("AWS::Grafana::Workspace", 1);
    t.hasResourceProperties("AWS::Grafana::Workspace", {
      Name: "human-query-dev",
      AccountAccessType: "CURRENT_ACCOUNT",
      AuthenticationProviders: ["AWS_SSO"],
      PermissionType: "SERVICE_MANAGED",
      DataSources: ["CLOUDWATCH", "XRAY"],
    });
  });

  it("stage=prod without createWorkspace returns empty endpoint (MOCK fallback)", () => {
    const stack = mkStack();
    const c = new GrafanaWorkspaceConstruct(stack, "Grafana", {
      stage: "prod",
      context: { aws: { createWorkspace: false } },
    });
    expect(c.backing).toBe("none");
    expect(c.endpoint).toBe("");
  });

  it("stage=test creates AMG when context flag is set, applies custom data sources", () => {
    const stack = mkStack();
    const c = new GrafanaWorkspaceConstruct(stack, "Grafana", {
      stage: "test",
      context: {
        aws: {
          createWorkspace: true,
          dataSources: ["CLOUDWATCH"],
          notificationDestinations: [],
        },
      },
    });
    expect(c.backing).toBe("amg-created");
    const t = Template.fromStack(stack);
    t.hasResourceProperties("AWS::Grafana::Workspace", {
      DataSources: ["CLOUDWATCH"],
      NotificationDestinations: [],
    });
  });
});
