import type { BuiltQueries, StructuredQueryIntent } from "../shared/query-intent";

function escapeFilterValue(v: string | number | boolean): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function hoursFromTimeRange(intent: StructuredQueryIntent): number {
  const tr = intent.timeRange;
  if (!tr) return 24;
  if (tr.unit === "hour") return Math.min(168, Math.max(1, tr.value));
  if (tr.unit === "day") return Math.min(168, Math.max(1, tr.value * 24));
  if (tr.unit === "week") return Math.min(168, Math.max(1, tr.value * 24 * 7));
  return 24;
}

export function buildWarehouseQueries(
  intent: StructuredQueryIntent,
  defaultLogGroups: string[],
): BuiltQueries {
  const warehouseId = String(intent.entityFilters?.warehouseId ?? "*");
  const hours = hoursFromTimeRange(intent);
  const logGroups = defaultLogGroups.length ? defaultLogGroups : ["/aws/lambda/warehouse-service-demo"];

  const logsInsightsQuery = [
    `fields @timestamp, @message`,
    `| filter @message like /delay|inventory|warehouse/i`,
    warehouseId !== "*"
      ? `| filter @message like /${escapeFilterValue(warehouseId).replace(/"/g, "")}/`
      : "",
    `| filter @timestamp > ago(${hours}h)`,
    intent.visualization === "timeseries"
      ? `| stats count() as events by bin(5m)`
      : `| sort @timestamp desc`,
    `| limit 1000`,
  ]
    .filter(Boolean)
    .join("\n");

  const xrayFilter =
    warehouseId !== "*"
      ? `annotation.warehouseId = "${escapeFilterValue(warehouseId)}" AND annotation.delayMs > 1000`
      : `annotation.delayMs > 1000`;

  return {
    logsInsightsQuery,
    xrayFilterExpression: xrayFilter,
    logGroupNames: logGroups,
    notes: [
      "Warehouse builder: tune log line filters to match your log format.",
      "Emit X-Ray annotations: warehouseId, operationType, delayMs (see code_generation_context.md).",
    ],
  };
}

export function buildWarehouseShipmentFailure(
  intent: StructuredQueryIntent,
  defaultLogGroups: string[],
): BuiltQueries {
  const q = buildWarehouseQueries(intent, defaultLogGroups);
  return {
    ...q,
    logsInsightsQuery: `${q.logsInsightsQuery}\n| filter @message like /failure|error|shipment/i`,
    notes: [...q.notes, "Intent: shipment_failure_analysis — stricter failure token filter."],
  };
}
