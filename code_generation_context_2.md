a sample lambda that sends generated query to grafana and notes how to optimise rendering.

Example architecture:

User → AI Query Generator → Lambda → Grafana Dashboard API

This Lambda:

receives a generated CloudWatch Logs Insights query
updates a Grafana panel dynamically
Grafana executes the query itself

Example request body to Lambda:

{
  "dashboardUid": "ops-dashboard",
  "panelId": 4,
  "query": "fields @timestamp, latency | stats avg(latency) by bin(5m)"
}

Lambda example (Node.js 20):

import axios from "axios";

const GRAFANA_URL = process.env.GRAFANA_URL!;
const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY!;

export const handler = async (event: any) => {

  const body = typeof event.body === "string"
    ? JSON.parse(event.body)
    : event;

  const {
    dashboardUid,
    panelId,
    query
  } = body;

  // 1. Fetch dashboard JSON
  const dashboardResponse = await axios.get(
    `${GRAFANA_URL}/api/dashboards/uid/${dashboardUid}`,
    {
      headers: {
        Authorization: `Bearer ${GRAFANA_API_KEY}`
      }
    }
  );

  const dashboard = dashboardResponse.data.dashboard;

  // 2. Find target panel
  const panel = dashboard.panels.find(
    (p: any) => p.id === panelId
  );

  if (!panel) {
    throw new Error(`Panel ${panelId} not found`);
  }

  // 3. Replace CloudWatch Logs Insights query
  panel.targets = [
    {
      refId: "A",
      region: "ap-southeast-2",
      queryMode: "Logs",
      expression: query,
      datasource: {
        type: "cloudwatch",
        uid: "cloudwatch"
      }
    }
  ];

  // 4. Push updated dashboard back to Grafana
  await axios.post(
    `${GRAFANA_URL}/api/dashboards/db`,
    {
      dashboard,
      overwrite: true
    },
    {
      headers: {
        Authorization: `Bearer ${GRAFANA_API_KEY}`,
        "Content-Type": "application/json"
      }
    }
  );

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true
    })
  };
};

Environment variables:

GRAFANA_URL=https://grafana.example.com
GRAFANA_API_KEY=xxxxx

Example generated query:

fields @timestamp, durationMs
| filter service = "orders"
| stats avg(durationMs) as avgDuration by bin(5m)

Example Grafana datasource:

CloudWatch datasource
UID: cloudwatch

CDK example:

fn.addEnvironment(
  "GRAFANA_URL",
  "https://grafana.example.com"
);

fn.addEnvironment(
  "GRAFANA_API_KEY",
  grafanaApiKey.secretValue.toString()
);

Recommended secure approach:

store API key in:
Amazon Web Services Secrets Manager
or SSM Parameter Store

Typical production flow:

User Prompt
   ↓
AI extracts intent
   ↓
Deterministic query builder
   ↓
Lambda updates Grafana panel
   ↓
Grafana runs CloudWatch query
   ↓
Dashboard updates live

A better long-term approach is often:

keep Grafana dashboard static
dynamically update panel variables
avoid rewriting dashboard JSON every request

because constant dashboard mutations:

create version churn
race conditions
audit noise

Alternative cleaner design:

Grafana Variable = ${dynamicQuery}

Then Lambda only updates variable values instead of full dashboards.
