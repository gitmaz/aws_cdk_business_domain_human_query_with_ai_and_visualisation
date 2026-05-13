import { describe, expect, it } from "vitest";
import { DOMAIN_REGISTRY, validateIntentAgainstRegistry } from "../lambda/shared/domain-registry";

describe("domain-registry", () => {
  it("lists four domains", () => {
    expect(Object.keys(DOMAIN_REGISTRY).sort()).toEqual(["finance", "manufacturing", "ordering", "warehouse"]);
  });

  it("accepts registered warehouse intent", () => {
    expect(validateIntentAgainstRegistry("warehouse", "inventory_delay_analysis")).toBeNull();
  });

  it("rejects unknown domain", () => {
    const err = validateIntentAgainstRegistry("unknown", "x");
    expect(err).toContain("Unknown domain");
  });

  it("rejects intent not in domain", () => {
    const err = validateIntentAgainstRegistry("warehouse", "payment_latency_analysis");
    expect(err).toContain("not supported");
  });
});
