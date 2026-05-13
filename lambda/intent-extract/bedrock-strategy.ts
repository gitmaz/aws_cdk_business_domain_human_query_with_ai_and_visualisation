import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { buildIntentSystemPrompt } from "./intent-system-prompt";
import { parseStructuredIntentFromModelText } from "./parse-model-intent";
import type { StructuredQueryIntent } from "../shared/query-intent";

const defaultModelId = "anthropic.claude-3-haiku-20240307-v1:0";

/**
 * Anthropic Messages shape on Bedrock (`InvokeModel`).
 * Set **`BEDROCK_MODEL_ID`** to another Claude / compatible model in the same account/region.
 */
export async function extractIntentWithBedrock(userMessage: string): Promise<StructuredQueryIntent> {
  const modelId = process.env.BEDROCK_MODEL_ID?.trim() || defaultModelId;
  const region = process.env.BEDROCK_REGION?.trim() || process.env.AWS_REGION?.trim();
  const client = new BedrockRuntimeClient(region ? { region } : {});

  const system = buildIntentSystemPrompt();
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    temperature: 0,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  const out = await client.send(
    new InvokeModelCommand({
      modelId,
      contentType: "application/json",
      accept: "application/json",
      body: new TextEncoder().encode(body),
    })
  );

  let raw = "";
  if (out.body) {
    const b = out.body as { transformToString?: () => Promise<string> };
    if (typeof b.transformToString === "function") {
      raw = await b.transformToString();
    } else {
      raw = Buffer.from(out.body as Uint8Array).toString("utf8");
    }
  }
  if (!raw.trim()) throw new Error("Bedrock returned empty body");

  let parsed: { content?: { type?: string; text?: string }[] };
  try {
    parsed = JSON.parse(raw) as { content?: { type?: string; text?: string }[] };
  } catch {
    throw new Error("Bedrock response was not JSON");
  }

  const textBlock = parsed.content?.find((c) => c.type === "text" && typeof c.text === "string");
  const modelText = textBlock?.text;
  if (!modelText?.trim()) throw new Error("Bedrock response missing text content");

  return parseStructuredIntentFromModelText(modelText, userMessage.trim());
}
