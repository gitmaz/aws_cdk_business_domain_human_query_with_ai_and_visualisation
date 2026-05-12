import type { BuiltQueries, StructuredQueryIntent } from "../shared/query-intent";

function hours(intent: StructuredQueryIntent): number {
  const tr = intent.timeRange;
  if (!tr) return 24;
  if (tr.unit === "hour") return Math.min(168, tr.value);
  if (tr.unit === "day") return Math.min(168, tr.value * 24);
  return Math.min(168, tr.value * 24 * 7);
}

export function buildManufacturingQueries(intent: StructuredQueryIntent, logGroups: string[]): BuiltQueries {
  const lineId = String(intent.entityFilters?.lineId ?? intent.entityFilters?.stationId ?? "*");
  const h = hours(intent);
  const lgs = logGroups.length ? logGroups : ["/aws/lambda/manufacturing-service-demo"];
  const logsInsightsQuery = [
    `fields @timestamp, @message`,
    `| filter @message like /stoppage|line|station/i`,
    lineId !== "*" ? `| filter @message like /${String(lineId).replace(/[|*]/g, "")}/` : "",
    `| filter @timestamp > ago(${h}h)`,
    `| stats count() by bin(5m)`,
    `| limit 500`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    logsInsightsQuery,
    xrayFilterExpression:
      lineId !== "*"
        ? `annotation.lineId = "${lineId}" OR annotation.stationId = "${lineId}"`
        : `annotation.severity = "high"`,
    logGroupNames: lgs,
    notes: ["Manufacturing: align filters with MES / line controller log format."],
  };
}
