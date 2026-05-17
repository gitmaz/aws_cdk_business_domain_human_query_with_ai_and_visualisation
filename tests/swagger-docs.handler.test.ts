import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildOpenApiDocument,
  handler,
  resolveRequestPath,
} from "../lambda/swagger-docs/index";

describe("swagger-docs handler", () => {
  const prev = process.env.API_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.API_PUBLIC_BASE_URL = "https://api.example.com";
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.API_PUBLIC_BASE_URL;
    else process.env.API_PUBLIC_BASE_URL = prev;
  });

  it("resolveRequestPath prefers rawPath", () => {
    expect(resolveRequestPath({ rawPath: "/docs/", path: "/ignored" } as never)).toBe("/docs");
  });

  it("buildOpenApiDocument sets servers from API_PUBLIC_BASE_URL", () => {
    const doc = buildOpenApiDocument("https://api.example.com");
    expect(doc.servers).toEqual([
      { url: "https://api.example.com", description: "Deployed API (Try it out targets these paths)" },
    ]);
    expect((doc.paths as Record<string, unknown>)["/intent"]).toBeDefined();
  });

  it("serves OpenAPI JSON at /openapi.json", async () => {
    const res = await handler({ rawPath: "/openapi.json" } as never);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.openapi).toBe("3.0.3");
    expect(body.servers[0].url).toBe("https://api.example.com");
  });

  it("serves Swagger UI HTML at /docs", async () => {
    const res = await handler({ rawPath: "/docs" } as never);
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["content-type"]).toContain("text/html");
    expect(res.body).toContain("swagger-ui");
    expect(res.body).toContain("https://api.example.com/openapi.json");
  });

  it("serves Swagger UI at / on Function URL", async () => {
    const res = await handler({ rawPath: "/" } as never);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("SwaggerUIBundle");
  });

  it("returns 404 for unknown paths", async () => {
    const res = await handler({ rawPath: "/unknown" } as never);
    expect(res.statusCode).toBe(404);
  });
});
