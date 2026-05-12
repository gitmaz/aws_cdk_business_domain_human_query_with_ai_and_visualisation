import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

vi.mock("aws-xray-sdk-core", () => ({
  default: {
    getSegment: () => ({
      addAnnotation: vi.fn(),
    }),
  },
}));

import { handler } from "../lambda/intent-extract/index";

function event(body: unknown): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    requestContext: {} as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    version: "2.0",
    routeKey: "POST /intent",
    rawPath: "/intent",
    rawQueryString: "",
  };
}

describe("intent-extract handler", () => {
  it("returns 400 when message empty", async () => {
    const res = await handler(event({ message: "   " }));
    expect(res.statusCode).toBe(400);
  });

  it("passthrough structuredIntent", async () => {
    const structuredIntent = {
      domain: "finance",
      intent: "payment_latency_analysis",
      entityFilters: { tenantId: "t1" },
      timeRange: { value: 12, unit: "hour" },
      visualization: "table" as const,
    };
    const res = await handler(event({ structuredIntent }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.mode).toBe("passthrough");
    expect(body.structuredIntent.domain).toBe("finance");
  });

  it("keyword routes warehouse Sydney", async () => {
    const res = await handler(
      event({ message: "warehouse delays Sydney inventory last day" }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.structuredIntent.domain).toBe("warehouse");
    expect(body.structuredIntent.entityFilters?.warehouseId).toBe("SYD-1");
  });
});
