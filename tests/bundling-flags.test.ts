import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { useDockerLambdaBundling } from "../lib/bundling-flags";

describe("useDockerLambdaBundling", () => {
  beforeEach(() => {
    delete process.env.CDK_FORCE_DOCKER_BUNDLING;
  });
  afterEach(() => {
    delete process.env.CDK_FORCE_DOCKER_BUNDLING;
  });

  it("is false without env or context", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    expect(useDockerLambdaBundling(stack)).toBe(false);
  });

  it("is true when CDK_FORCE_DOCKER_BUNDLING=1", () => {
    process.env.CDK_FORCE_DOCKER_BUNDLING = "1";
    const app = new App();
    const stack = new Stack(app, "TestStack");
    expect(useDockerLambdaBundling(stack)).toBe(true);
  });

  it("is true when context useDockerBundling is true", () => {
    const app = new App({ context: { useDockerBundling: "true" } });
    const stack = new Stack(app, "TestStack");
    expect(useDockerLambdaBundling(stack)).toBe(true);
  });
});
