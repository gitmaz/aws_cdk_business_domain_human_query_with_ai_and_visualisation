import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { CfnOutput, Duration } from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwIntegrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

import { resolveAiMode } from "../lambda/intent-extract/ai-mode";
import { useDockerLambdaBundling } from "./bundling-flags";
import type { StageId } from "./stage-config";

export interface BusinessDomainHumanQueryStackProps extends cdk.StackProps {
  stage: StageId;
}

/**
 * Semantic analytics layer (see `code_generation_context.md`):
 * - Intent API: NL → structured JSON (no raw CloudWatch query from AI).
 * - Query API: validated domain builders → Logs Insights string + X-Ray filter expression.
 */
export class BusinessDomainHumanQueryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BusinessDomainHumanQueryStackProps) {
    super(scope, id, props);
    const { stage } = props;

    const humanQuery = this.node.tryGetContext("humanQuery") as Record<string, string[]> | undefined;
    const warehouseLgs = (humanQuery?.defaultWarehouseLogGroups as string[] | undefined)?.join(",") ?? "";
    const manufacturingLgs = (humanQuery?.defaultManufacturingLogGroups as string[] | undefined)?.join(",") ?? "";
    const financeLgs = (humanQuery?.defaultFinanceLogGroups as string[] | undefined)?.join(",") ?? "";
    const orderingLgs = (humanQuery?.defaultOrderingLogGroups as string[] | undefined)?.join(",") ?? "";

    const aiModeRaw =
      (this.node.tryGetContext("aiMode") as string | undefined)?.trim() || process.env.AI_MODE?.trim() || "AI_MOCK";
    const aiMode = resolveAiMode(aiModeRaw);

    const commonEnv = {
      STAGE: stage,
      DEFAULT_WAREHOUSE_LOG_GROUPS: warehouseLgs,
      DEFAULT_MANUFACTURING_LOG_GROUPS: manufacturingLgs,
      DEFAULT_FINANCE_LOG_GROUPS: financeLgs,
      DEFAULT_ORDERING_LOG_GROUPS: orderingLgs,
    };

    const intentEnv = {
      ...commonEnv,
      AI_MODE: aiMode,
      OPENAI_MODEL: process.env.OPENAI_MODEL?.trim() ?? "",
      OPENAI_API_BASE: process.env.OPENAI_API_BASE?.trim() ?? "",
      BEDROCK_MODEL_ID: process.env.BEDROCK_MODEL_ID?.trim() ?? "",
      BEDROCK_REGION: process.env.BEDROCK_REGION?.trim() ?? "",
    };

    const forceDocker = useDockerLambdaBundling(this);
    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      tracing: lambda.Tracing.ACTIVE,
      environment: commonEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
        ...(forceDocker ? { forceDockerBundling: true } : {}),
      },
    };

    const intentFn = new NodejsFunction(this, "IntentExtractFn", {
      ...lambdaDefaults,
      entry: path.join(__dirname, "..", "lambda", "intent-extract", "index.ts"),
      handler: "handler",
      description: `NL / structured hint → StructuredQueryIntent (${stage})`,
      environment: intentEnv,
      bundling: {
        ...lambdaDefaults.bundling,
        // Bundle Bedrock client (not guaranteed on the managed Lambda SDK set).
        externalModules: [],
      },
    });

    const grantBedrockInvoke =
      aiMode === "BEDROCK" ||
      this.node.tryGetContext("grantBedrockInvoke") === true ||
      this.node.tryGetContext("grantBedrockInvoke") === "true";

    if (grantBedrockInvoke) {
      intentFn.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:aws:bedrock:${this.region}::foundation-model/*`,
            `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
          ],
        })
      );
    }

    const queryFn = new NodejsFunction(this, "QueryDispatchFn", {
      ...lambdaDefaults,
      entry: path.join(__dirname, "..", "lambda", "query-dispatch", "index.ts"),
      handler: "handler",
      description: `Validate intent + domain query builders (${stage})`,
    });

    const httpApi = new apigwv2.HttpApi(this, "HumanQueryHttpApi", {
      apiName: `human-query-intent-${stage}`,
      corsPreflight: {
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins: ["*"],
      },
    });

    httpApi.addRoutes({
      path: "/intent",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration("IntentIntegration", intentFn),
    });

    httpApi.addRoutes({
      path: "/query/build",
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwIntegrations.HttpLambdaIntegration("QueryBuildIntegration", queryFn),
    });

    new CfnOutput(this, "HttpApiUrl", {
      value: httpApi.apiEndpoint,
      description: "Base URL for POST /intent and POST /query/build",
    });
    new CfnOutput(this, "Stage", { value: stage });
  }
}
