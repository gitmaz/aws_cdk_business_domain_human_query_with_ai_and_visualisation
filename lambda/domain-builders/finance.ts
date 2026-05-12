import type { BuiltQueries, StructuredQueryIntent } from "../shared/query-intent";

function hours(intent: StructuredQueryIntent): number {
  const tr = intent.timeRange;
  if (!tr) return 24;
  if (tr.unit === "hour") return Math.min(168, tr.value);
  if (tr.unit === "day") return Math.min(168, tr.value * 24);
  return Math.min(168, tr.value * 24 * 7);
}

export function buildFinanceQueries(intent: StructuredQueryIntent, logGroups: string[]): BuiltQueries {
  const tenantId = String(intent.entityFilters?.tenantId ?? "*");
  const h = hours(intent);
  const lgs = logGroups.length ? logGroups : ["/aws/lambda/finance-service-demo"];
  const logsInsightsQuery = [
    `fields @timestamp, @message`,
    `| filter @message like /payment|latency|reconciliation/i`,
    tenantId !== "*" ? `| filter @message like /${tenantId.replace(/[|*]/g, "")}/` : "",
    `| filter @timestamp > ago(${h}h)`,
    `| sort @timestamp desc`,
    `| limit 500`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    logsInsightsQuery,
    xrayFilterExpression:
      tenantId !== "*"
        ? `annotation.tenantId = "${tenantId}" AND annotation.latencyMs > 500`
        : `annotation.paymentRail exists`,
    logGroupNames: lgs,
    notes: ["Finance: wire to PSP / ledger log fields in production."],
  };
}
