import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import AWSXRay from "aws-xray-sdk-core";
import type { StructuredQueryIntent } from "../shared/query-intent";

/**
 * Placeholder for **OpenAI / Bedrock / Anthropic**: must return **StructuredQueryIntent** only.
 * Demo path: keyword routing + optional passthrough of `structuredIntent` in the body.
 */
function extractFromNaturalLanguage(message: string): StructuredQueryIntent {
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

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const seg = AWSXRay.getSegment();
  if (seg) {
    seg.addAnnotation("handler", "intent-extract");
  }

  try {
    const raw = event.body ? JSON.parse(event.body) : {};
    const passthrough = raw.structuredIntent as StructuredQueryIntent | undefined;
    if (passthrough?.domain && passthrough?.intent) {
      if (seg) seg.addAnnotation("domain", String(passthrough.domain));
      return json(200, { structuredIntent: passthrough, mode: "passthrough" });
    }

    const message = String(raw.message ?? raw.naturalLanguage ?? raw.question ?? "");
    if (!message.trim()) {
      return json(400, { error: "Provide message, naturalLanguage, question, or structuredIntent" });
    }

    const structuredIntent = extractFromNaturalLanguage(message);
    if (seg) {
      seg.addAnnotation("domain", String(structuredIntent.domain));
      seg.addAnnotation("intent", structuredIntent.intent);
    }

    return json(200, { structuredIntent, mode: "demo_keywords" });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
};
