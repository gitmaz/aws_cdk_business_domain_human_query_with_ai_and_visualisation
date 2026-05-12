import type { BuiltQueries, StructuredQueryIntent } from "../shared/query-intent";

function hours(intent: StructuredQueryIntent): number {
  const tr = intent.timeRange;
  if (!tr) return 24;
  if (tr.unit === "hour") return Math.min(168, tr.value);
  if (tr.unit === "day") return Math.min(168, tr.value * 24);
  return Math.min(168, tr.value * 24 * 7);
}

export function buildOrderingQueries(intent: StructuredQueryIntent, logGroups: string[]): BuiltQueries {
  const region = String(intent.entityFilters?.region ?? "*");
  const h = hours(intent);
  const lgs = logGroups.length ? logGroups : ["/aws/lambda/ordering-service-demo"];
  const logsInsightsQuery = [
    `fields @timestamp, @message`,
    `| filter @message like /order|fulfill|sla/i`,
    region !== "*" ? `| filter @message like /${region.replace(/[|*]/g, "")}/` : "",
    `| filter @timestamp > ago(${h}h)`,
    intent.visualization === "timeseries"
      ? `| stats count() as orders by bin(5m)`
      : `| stats count() as orders`,
    `| limit 500`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    logsInsightsQuery,
    xrayFilterExpression:
      region !== "*"
        ? `annotation.region = "${region}" AND annotation.delayMs > 0`
        : `annotation.slaTier exists`,
    logGroupNames: lgs,
    notes: ["Ordering: map entityFilters.region to OMS / WMS identifiers."],
  };
}
