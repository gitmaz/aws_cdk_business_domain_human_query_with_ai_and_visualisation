import { buildIntentSystemPrompt } from "./intent-system-prompt";
import { parseStructuredIntentFromModelText } from "./parse-model-intent";
import type { StructuredQueryIntent } from "../shared/query-intent";

export async function extractIntentWithOpenAI(userMessage: string): Promise<StructuredQueryIntent> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set on the intent Lambda");
  }

  const base = (process.env.OPENAI_API_BASE?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const system = buildIntentSystemPrompt();

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("OpenAI returned non-JSON body");
  }

  const content = (body as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenAI response missing choices[0].message.content");
  }

  return parseStructuredIntentFromModelText(content, userMessage.trim());
}
