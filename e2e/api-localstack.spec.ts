import { test, expect } from "@playwright/test";

function apiBase(): string {
  const raw = process.env.PLAYWRIGHT_API_BASE_URL?.trim() ?? "";
  return raw.replace(/\/$/, "");
}

test.describe("HTTP API (LocalStack or AWS)", () => {
  test("POST /intent then POST /query/build", async ({ request }) => {
    const base = apiBase();
    test.skip(!base, "Set PLAYWRIGHT_API_BASE_URL to HttpApiUrl (see README-test.md)");

    const intentRes = await request.post(`${base}/intent`, {
      data: { message: "Show inventory delays in Sydney warehouse over last 24 hours" },
    });
    expect(intentRes.ok(), await intentRes.text()).toBeTruthy();
    const intentBody = await intentRes.json();
    expect(intentBody.structuredIntent?.domain).toBe("warehouse");
    expect(intentBody.structuredIntent?.intent).toBeTruthy();

    const buildRes = await request.post(`${base}/query/build`, {
      data: intentBody.structuredIntent,
    });
    expect(buildRes.ok(), await buildRes.text()).toBeTruthy();
    const buildBody = await buildRes.json();
    expect(buildBody.builtQueries?.logsInsightsQuery).toBeTruthy();
    expect(buildBody.builtQueries?.xrayFilterExpression).toBeTruthy();
  });

  test("POST /query/build rejects unknown intent", async ({ request }) => {
    const base = apiBase();
    test.skip(!base, "Set PLAYWRIGHT_API_BASE_URL to HttpApiUrl (see README-test.md)");

    const res = await request.post(`${base}/query/build`, {
      data: {
        domain: "warehouse",
        intent: "not_a_real_intent",
        entityFilters: { warehouseId: "X" },
        timeRange: { value: 1, unit: "hour" },
      },
    });
    expect(res.status()).toBe(400);
  });
});
