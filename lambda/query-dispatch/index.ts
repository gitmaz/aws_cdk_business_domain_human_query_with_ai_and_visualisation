import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { buildQueriesForIntent } from "../domain-builders/index";
import type { StructuredQueryIntent } from "../shared/query-intent";

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  body: JSON.stringify(body),
});

/**
 * Validates **StructuredQueryIntent** against the domain registry and returns
 * **Logs Insights** + **X-Ray filter** strings — never accepts raw query language from clients.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = event.body ? JSON.parse(event.body) : {};
    const intent = raw as StructuredQueryIntent;
    if (!intent?.domain || !intent?.intent) {
      return json(400, { error: "Body must include domain and intent (StructuredQueryIntent)" });
    }

    const built = buildQueriesForIntent(intent, process.env);
    return json(200, {
      intent,
      builtQueries: built,
      hint: "Paste logsInsightsQuery into CloudWatch Logs Insights or Grafana; use xrayFilterExpression in X-Ray console / Service Lens.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Unknown domain") || msg.includes("not supported") ? 400 : 500;
    return json(status, { error: msg });
  }
};
