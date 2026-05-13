/**
 * Structured query intent — AI / NL layer must output **only** this shape (or a superset
 * merged then validated). **Never** raw CloudWatch Insights strings from the model.
 * @see code_generation_context.md
 */
export type QueryDomain = "warehouse" | "manufacturing" | "finance" | "ordering";

export type TimeUnit = "hour" | "day" | "week";

export interface StructuredQueryIntent {
  domain: QueryDomain | string;
  intent: string;
  entityFilters?: Record<string, string | number | boolean>;
  timeRange?: { value: number; unit: TimeUnit };
  visualization?: "timeseries" | "table" | "stat";
  /** Optional free-form source question for audit */
  sourceQuestion?: string;
}

export interface BuiltQueries {
  /** Amazon CloudWatch Logs Insights query language (built by trusted code). */
  logsInsightsQuery: string;
  /** X-Ray filter expression fragment (console / API). */
  xrayFilterExpression: string;
  /** Log group names the Insights query targets (documentation / Grafana). */
  logGroupNames: string[];
  /** Human-readable notes for operators / Grafana panels. */
  notes: string[];
}
