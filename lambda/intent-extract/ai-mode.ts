export type ResolvedAiMode = "AI_MOCK" | "OPENAI" | "BEDROCK";

/**
 * `AI_MODE` on the intent Lambda: default **`AI_MOCK`** (keyword placeholder).
 * Also accepts **`MOCK`** as an alias for **`AI_MOCK`**.
 */
export function resolveAiMode(raw: string | undefined): ResolvedAiMode {
  const v = (raw ?? "AI_MOCK").trim().toUpperCase();
  if (v === "AI_MOCK" || v === "MOCK") return "AI_MOCK";
  if (v === "OPENAI") return "OPENAI";
  if (v === "BEDROCK") return "BEDROCK";
  return "AI_MOCK";
}
