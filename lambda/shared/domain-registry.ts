export interface DomainRegistryEntry {
  supportedIntents: string[];
  /** Annotation keys services should emit for X-Ray (documentation + builder hints). */
  xrayAnnotationKeys: string[];
}

/**
 * Registry pattern from architecture doc — dispatcher routes by `domain` + validates `intent`.
 */
export const DOMAIN_REGISTRY: Record<string, DomainRegistryEntry> = {
  warehouse: {
    supportedIntents: ["inventory_delay_analysis", "shipment_failure_analysis"],
    xrayAnnotationKeys: ["warehouseId", "operationType", "delayMs", "productCategory", "status"],
  },
  manufacturing: {
    supportedIntents: ["line_stoppage_analysis", "throughput_drop_analysis"],
    xrayAnnotationKeys: ["lineId", "stationId", "severity", "durationMs"],
  },
  finance: {
    supportedIntents: ["payment_latency_analysis", "reconciliation_backlog_analysis"],
    xrayAnnotationKeys: ["tenantId", "paymentRail", "amountBucket", "latencyMs"],
  },
  ordering: {
    supportedIntents: ["order_fulfillment_delay_analysis", "cart_abandonment_spike_analysis"],
    xrayAnnotationKeys: ["orderId", "region", "slaTier", "delayMs"],
  },
};

export function validateIntentAgainstRegistry(domain: string, intent: string): string | null {
  const entry = DOMAIN_REGISTRY[domain];
  if (!entry) return `Unknown domain "${domain}". Known: ${Object.keys(DOMAIN_REGISTRY).join(", ")}`;
  if (!entry.supportedIntents.includes(intent)) {
    return `Intent "${intent}" not supported for domain "${domain}". Allowed: ${entry.supportedIntents.join(", ")}`;
  }
  return null;
}
