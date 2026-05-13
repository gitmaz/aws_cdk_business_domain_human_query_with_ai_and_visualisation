import { DOMAIN_REGISTRY } from "../shared/domain-registry";

const registryLines = Object.entries(DOMAIN_REGISTRY)
  .map(([domain, e]) => `- domain "${domain}": intents [${e.supportedIntents.map((i) => `"${i}"`).join(", ")}]`)
  .join("\n");

/** Single system prompt for OpenAI + Bedrock (JSON-only contract). */
export function buildIntentSystemPrompt(): string {
  return `You map operator questions to a single JSON object only — no markdown, no prose, no code fences.

Output must match this TypeScript shape (use only listed domain + intent pairs):
{
  "domain": string,
  "intent": string,
  "entityFilters"?: Record<string, string | number | boolean>,
  "timeRange"?: { "value": number, "unit": "hour" | "day" | "week" },
  "visualization"?: "timeseries" | "table" | "stat",
  "sourceQuestion"?: string
}

Allowed domain and intent combinations:
${registryLines}

Rules:
- Choose the best-matching domain and intent from the list only.
- Never emit CloudWatch Logs Insights queries, SQL, or raw filter expressions.
- entityFilters keys should align with that domain (e.g. warehouseId, lineId, tenantId, region).
- sourceQuestion should echo the user's question briefly for audit.`;
}
