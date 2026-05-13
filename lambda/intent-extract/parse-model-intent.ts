import { validateIntentAgainstRegistry } from "../shared/domain-registry";
import type { StructuredQueryIntent } from "../shared/query-intent";

function extractJsonObject(text: string): string {
  const t = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im.exec(t);
  if (fence?.[1]) return fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}

export function parseStructuredIntentFromModelText(raw: string, fallbackSource: string): StructuredQueryIntent {
  const jsonStr = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Model did not return valid JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Model JSON must be an object");

  const o = parsed as Record<string, unknown>;
  const domain = o.domain;
  const intent = o.intent;
  if (typeof domain !== "string" || typeof intent !== "string") {
    throw new Error("Model JSON must include string fields domain and intent");
  }

  const err = validateIntentAgainstRegistry(domain, intent);
  if (err) throw new Error(err);

  const structured: StructuredQueryIntent = {
    domain,
    intent,
    entityFilters:
      o.entityFilters && typeof o.entityFilters === "object" && !Array.isArray(o.entityFilters)
        ? (o.entityFilters as Record<string, string | number | boolean>)
        : undefined,
    timeRange: (() => {
      const tr = o.timeRange;
      if (!tr || typeof tr !== "object" || tr === null) return undefined;
      const value = (tr as { value?: unknown }).value;
      const unit = (tr as { unit?: unknown }).unit;
      if (typeof value !== "number" || (unit !== "hour" && unit !== "day" && unit !== "week")) return undefined;
      return { value, unit };
    })(),
    visualization:
      o.visualization === "timeseries" || o.visualization === "table" || o.visualization === "stat"
        ? o.visualization
        : undefined,
    sourceQuestion: typeof o.sourceQuestion === "string" ? o.sourceQuestion : fallbackSource,
  };

  return structured;
}
