import { describe, expect, it } from "vitest";
import { buildQueriesForIntent } from "../lambda/domain-builders/index";
import type { StructuredQueryIntent } from "../lambda/shared/query-intent";

const demoEnv = {
  DEFAULT_WAREHOUSE_LOG_GROUPS: "/aws/lambda/warehouse-service-demo",
  DEFAULT_MANUFACTURING_LOG_GROUPS: "/aws/lambda/mfg-demo",
  DEFAULT_FINANCE_LOG_GROUPS: "/aws/lambda/fin-demo",
  DEFAULT_ORDERING_LOG_GROUPS: "/aws/lambda/ord-demo",
} as NodeJS.ProcessEnv;

describe("buildQueriesForIntent", () => {
  it("builds warehouse inventory delay queries", () => {
    const intent: StructuredQueryIntent = {
      domain: "warehouse",
      intent: "inventory_delay_analysis",
      entityFilters: { warehouseId: "SYD-1" },
      timeRange: { value: 24, unit: "hour" },
      visualization: "timeseries",
    };
    const q = buildQueriesForIntent(intent, demoEnv);
    expect(q.logsInsightsQuery).toContain("fields @timestamp");
    expect(q.xrayFilterExpression).toContain("warehouseId");
    expect(q.logGroupNames.length).toBeGreaterThan(0);
  });

  it("throws for invalid intent", () => {
    const intent: StructuredQueryIntent = {
      domain: "warehouse",
      intent: "invalid_intent",
      entityFilters: {},
    };
    expect(() => buildQueriesForIntent(intent, demoEnv)).toThrow(/not supported/);
  });
});
