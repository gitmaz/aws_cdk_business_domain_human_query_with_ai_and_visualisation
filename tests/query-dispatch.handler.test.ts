import { beforeEach, describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "../lambda/query-dispatch/index";

const demoEnv: Partial<NodeJS.ProcessEnv> = {
  DEFAULT_WAREHOUSE_LOG_GROUPS: "/aws/lambda/warehouse-service-demo",
  DEFAULT_MANUFACTURING_LOG_GROUPS: "",
  DEFAULT_FINANCE_LOG_GROUPS: "",
  DEFAULT_ORDERING_LOG_GROUPS: "",
};

function mkEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    requestContext: {} as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
    version: "2.0",
    routeKey: "POST /query/build",
    rawPath: "/query/build",
    rawQueryString: "",
  };
}

describe("query-dispatch handler", () => {
  beforeEach(() => {
    Object.assign(process.env, demoEnv);
  });

  it("returns built queries for valid intent", async () => {
    const res = await handler(
      mkEvent({
        domain: "warehouse",
        intent: "inventory_delay_analysis",
        entityFilters: { warehouseId: "WH-1" },
        timeRange: { value: 6, unit: "hour" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(String(res.body));
    expect(body.builtQueries.logsInsightsQuery).toContain("fields @timestamp");
  });

  it("returns 400 when domain missing", async () => {
    const res = await handler(mkEvent({ intent: "inventory_delay_analysis" }));
    expect(res.statusCode).toBe(400);
  });
});
