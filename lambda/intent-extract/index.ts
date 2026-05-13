import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import AWSXRay from "aws-xray-sdk-core";
import type { StructuredQueryIntent } from "../shared/query-intent";
import { resolveAiMode } from "./ai-mode";
import { extractIntentWithBedrock } from "./bedrock-strategy";
import { extractFromNaturalLanguage } from "./mock-extract";
import { extractIntentWithOpenAI } from "./openai-strategy";

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

  const aiMode = resolveAiMode(process.env.AI_MODE);
  if (seg) seg.addAnnotation("aiMode", aiMode);

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

    let structuredIntent: StructuredQueryIntent;
    let mode: string;

    if (aiMode === "AI_MOCK") {
      structuredIntent = extractFromNaturalLanguage(message);
      mode = "ai_mock";
    } else if (aiMode === "OPENAI") {
      structuredIntent = await extractIntentWithOpenAI(message);
      mode = "openai";
    } else {
      structuredIntent = await extractIntentWithBedrock(message);
      mode = "bedrock";
    }

    if (seg) {
      seg.addAnnotation("domain", String(structuredIntent.domain));
      seg.addAnnotation("intent", structuredIntent.intent);
    }

    return json(200, { structuredIntent, mode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status =
      /OPENAI_API_KEY|is not set on the intent lambda/i.test(msg) ? 503 : /HTTP \d{3}/i.test(msg) ? 502 : 500;
    return json(status, { error: msg, aiMode });
  }
};
