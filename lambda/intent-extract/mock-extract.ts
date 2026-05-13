import type { StructuredQueryIntent } from "../shared/query-intent";

/**
 * Keyword routing demo — same behavior as the original placeholder.
 */
export function extractFromNaturalLanguage(message: string): StructuredQueryIntent {
  const m = message.toLowerCase();
  const sourceQuestion = message.trim();

  if (/(warehouse|sydney|inventory|stock)/i.test(m)) {
    const warehouseId = /syd|sydney|SYD-1/i.test(message) ? "SYD-1" : "DEFAULT-WH";
    if (/shipment|failure|failed delivery/i.test(m)) {
      return {
        domain: "warehouse",
        intent: "shipment_failure_analysis",
        entityFilters: { warehouseId },
        timeRange: { value: 24, unit: "hour" },
        visualization: "timeseries",
        sourceQuestion,
      };
    }
    return {
      domain: "warehouse",
      intent: "inventory_delay_analysis",
      entityFilters: { warehouseId },
      timeRange: { value: 24, unit: "hour" },
      visualization: "timeseries",
      sourceQuestion,
    };
  }

  if (/(manufacturing|line|station|stoppage|throughput)/i.test(m)) {
    return {
      domain: "manufacturing",
      intent: /throughput/i.test(m) ? "throughput_drop_analysis" : "line_stoppage_analysis",
      entityFilters: { lineId: "LINE-01" },
      timeRange: { value: 8, unit: "hour" },
      visualization: "timeseries",
      sourceQuestion,
    };
  }

  if (/(finance|payment|reconciliation|ledger)/i.test(m)) {
    return {
      domain: "finance",
      intent: /reconciliation|backlog/i.test(m) ? "reconciliation_backlog_analysis" : "payment_latency_analysis",
      entityFilters: { tenantId: "tenant-demo" },
      timeRange: { value: 24, unit: "hour" },
      visualization: "table",
      sourceQuestion,
    };
  }

  if (/(order|fulfill|cart|sla)/i.test(m)) {
    return {
      domain: "ordering",
      intent: /cart|abandon/i.test(m) ? "cart_abandonment_spike_analysis" : "order_fulfillment_delay_analysis",
      entityFilters: { region: "AP-Southeast-2" },
      timeRange: { value: 24, unit: "hour" },
      visualization: "timeseries",
      sourceQuestion,
    };
  }

  return {
    domain: "warehouse",
    intent: "inventory_delay_analysis",
    entityFilters: { warehouseId: "UNKNOWN" },
    timeRange: { value: 24, unit: "hour" },
    visualization: "table",
    sourceQuestion,
  };
}
