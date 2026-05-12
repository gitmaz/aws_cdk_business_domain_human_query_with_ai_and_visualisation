import type { BuiltQueries, StructuredQueryIntent } from "../shared/query-intent";
import { validateIntentAgainstRegistry } from "../shared/domain-registry";
import { buildFinanceQueries } from "./finance";
import { buildManufacturingQueries } from "./manufacturing";
import { buildOrderingQueries } from "./ordering";
import { buildWarehouseQueries, buildWarehouseShipmentFailure } from "./warehouse";

function parseLogGroupsCsv(csv: string | undefined): string[] {
  if (!csv?.trim()) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Domain query dispatcher: **only** trusted builders produce CW Insights / X-Ray strings.
 */
export function buildQueriesForIntent(intent: StructuredQueryIntent, env: NodeJS.ProcessEnv): BuiltQueries {
  const err = validateIntentAgainstRegistry(intent.domain, intent.intent);
  if (err) {
    throw new Error(err);
  }

  const warehouseLgs = parseLogGroupsCsv(env.DEFAULT_WAREHOUSE_LOG_GROUPS);
  const manufacturingLgs = parseLogGroupsCsv(env.DEFAULT_MANUFACTURING_LOG_GROUPS);
  const financeLgs = parseLogGroupsCsv(env.DEFAULT_FINANCE_LOG_GROUPS);
  const orderingLgs = parseLogGroupsCsv(env.DEFAULT_ORDERING_LOG_GROUPS);

  switch (intent.domain) {
    case "warehouse":
      if (intent.intent === "inventory_delay_analysis") {
        return buildWarehouseQueries(intent, warehouseLgs);
      }
      return buildWarehouseShipmentFailure(intent, warehouseLgs);
    case "manufacturing":
      return buildManufacturingQueries(intent, manufacturingLgs);
    case "finance":
      return buildFinanceQueries(intent, financeLgs);
    case "ordering":
      return buildOrderingQueries(intent, orderingLgs);
    default:
      throw new Error(`No query builder registered for domain "${intent.domain}"`);
  }
}
