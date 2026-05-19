import { describe, expect, it, afterEach } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { resolveSpaHosting } from "../lib/resolve-spa-hosting";

describe("resolveSpaHosting", () => {
  const orig = process.env.SPA_HOSTING;

  afterEach(() => {
    if (orig === undefined) delete process.env.SPA_HOSTING;
    else process.env.SPA_HOSTING = orig;
  });

  function mode(ctx?: string, env?: string): string {
    if (env !== undefined) process.env.SPA_HOSTING = env;
    else delete process.env.SPA_HOSTING;
    const app = new App({ context: ctx !== undefined ? { spaHosting: ctx } : {} });
    const stack = new Stack(app, "Test");
    return resolveSpaHosting(stack);
  }

  it("defaults to lambda", () => {
    expect(mode()).toBe("lambda");
  });

  it("accepts none", () => {
    expect(mode(undefined, "none")).toBe("none");
    expect(mode("none")).toBe("none");
  });

  it("accepts skip as deprecated alias for none", () => {
    expect(mode(undefined, "skip")).toBe("none");
  });

  it("prefers SPA_HOSTING env over context", () => {
    expect(mode("ec2", "lambda")).toBe("lambda");
  });

  it("accepts cloudfront", () => {
    expect(mode(undefined, "cloudfront")).toBe("cloudfront");
    expect(mode("cloudfront")).toBe("cloudfront");
  });

  it("throws on invalid mode", () => {
    expect(() => mode(undefined, "cdn")).toThrow(/Invalid SPA_HOSTING/);
  });
});
