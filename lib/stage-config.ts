import type { Environment } from "aws-cdk-lib";

/**
 * Deployment stages — aligned with **`aws_cdk_invoice_processing_and_approval`** conventions.
 *
 * | Stage | Typical target |
 * | ----- | -------------- |
 * | **`local`** | LocalStack (`000000000000`, dummy keys in deploy script) |
 * | **`dev`** | AWS dev account |
 * | **`test`** | AWS pre-prod / QA |
 * | **`prod`** | AWS production |
 */
export const VALID_STAGES = ["local", "dev", "test", "prod"] as const;
export type StageId = (typeof VALID_STAGES)[number];

export function parseStage(raw: string | undefined): StageId {
  const s = (raw ?? "dev") as string;
  if (!VALID_STAGES.includes(s as StageId)) {
    throw new Error(`Invalid stage "${s}". Use one of: ${VALID_STAGES.join(", ")}`);
  }
  return s as StageId;
}

/**
 * CDK **`env`** for the stack: LocalStack uses the conventional dummy account; other stages use caller env.
 */
export function stackEnvForStage(stage: StageId): Environment {
  const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  if (stage === "local") {
    return { account: "000000000000", region };
  }
  return {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  };
}
