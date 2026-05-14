import * as path from "path";
import * as cdk from "aws-cdk-lib";
import { CfnOutput, Duration } from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwIntegrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

import { resolveAiMode } from "../lambda/intent-extract/ai-mode";
import { useDockerLambdaBundling } from "./bundling-flags";
import { GrafanaWorkspaceConstruct, type GrafanaContext } from "./grafana-workspace-construct";
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

    /**
     * Grafana visualization layer (see `code_generation_context_2.md`).
     *
     * Stage-aware backing (handled by `GrafanaWorkspaceConstruct`):
     * - **`local`** → local Grafana Docker (`docker/grafana/docker-compose.yml`); the Lambda runs
     *   inside LocalStack and reaches it via `host.docker.internal:3000` (Docker Desktop) or via
     *   the shared `human-query-net` bridge when LocalStack is launched with
     *   `LAMBDA_DOCKER_NETWORK=human-query-net`.
     * - **`dev|test|prod`** → optionally create **Amazon Managed Grafana** via `CfnWorkspace`
     *   (`humanQuery.grafana.aws.createWorkspace: true`), or point at an existing AMG via env /
     *   context `humanQuery.grafana.url`.
     *
     * Default request `mode: "variable"` keeps Grafana dashboards static and feeds dynamic
     * CloudWatch Insights queries via `?var-dynamicQuery=...` — no dashboard JSON mutation,
     * faster rendering.
     */
    const grafanaCtx = (this.node.tryGetContext("humanQuery") as Record<string, unknown> | undefined)?.grafana as
      | (GrafanaContext & {
          defaultDashboardUid?: string;
          defaultVariableName?: string;
          defaultPanelId?: number | string;
          defaultDatasourceUid?: string;
          rendererEnabled?: boolean | string;
          rendererWidth?: number | string;
          rendererHeight?: number | string;
          defaultRegion?: string;
        })
      | undefined;

    /**
     * Top-level context shortcuts for one-shot CLI overrides (since `-c a:b:c=true` does **not**
     * nest into the `humanQuery.grafana.*` tree — flat keys only).
     */
    const cliCreateWorkspace =
      this.node.tryGetContext("createGrafanaWorkspace") === true ||
      this.node.tryGetContext("createGrafanaWorkspace") === "true";
    const cliGrafanaUrl = (this.node.tryGetContext("grafanaUrl") as string | undefined)?.trim();

    const grafanaCtxMerged = {
      ...grafanaCtx,
      ...(cliCreateWorkspace
        ? { aws: { ...(grafanaCtx?.aws ?? {}), createWorkspace: true } }
        : {}),
    } as typeof grafanaCtx;

    const grafanaWorkspace = new GrafanaWorkspaceConstruct(this, "Grafana", {
      stage,
      context: grafanaCtxMerged,
      envUrl: cliGrafanaUrl || process.env.GRAFANA_URL?.trim(),
    });

    const grafanaUrl = grafanaWorkspace.endpoint;
    const grafanaApiKeyInline = process.env.GRAFANA_API_KEY?.trim() ?? "";
    const grafanaApiKeySecretArn =
      (process.env.GRAFANA_API_KEY_SECRET_ARN?.trim() || grafanaCtx?.apiKeySecretArn?.trim() || "");
    const grafanaDefaultDashboardUid =
      (process.env.GRAFANA_DEFAULT_DASHBOARD_UID?.trim() || grafanaCtx?.defaultDashboardUid?.trim() || "");
    const grafanaDefaultVariableName =
      (process.env.GRAFANA_DEFAULT_VARIABLE_NAME?.trim() || grafanaCtx?.defaultVariableName?.trim() || "dynamicQuery");
    const grafanaDefaultPanelId =
      (process.env.GRAFANA_DEFAULT_PANEL_ID?.trim() || (grafanaCtx?.defaultPanelId !== undefined ? String(grafanaCtx.defaultPanelId) : ""));
    const grafanaDefaultDatasourceUid =
      (process.env.GRAFANA_DEFAULT_DATASOURCE_UID?.trim() || grafanaCtx?.defaultDatasourceUid?.trim() || "cloudwatch");
    const grafanaDefaultRegion =
      (process.env.GRAFANA_DEFAULT_REGION?.trim() || grafanaCtx?.defaultRegion?.trim() || this.region);
    const grafanaRendererEnabled =
      (process.env.GRAFANA_RENDERER_ENABLED?.trim() ||
        (grafanaCtx?.rendererEnabled !== undefined ? String(grafanaCtx.rendererEnabled) : ""));
    const grafanaRendererWidth =
      (process.env.GRAFANA_RENDERER_WIDTH?.trim() ||
        (grafanaCtx?.rendererWidth !== undefined ? String(grafanaCtx.rendererWidth) : ""));
    const grafanaRendererHeight =
      (process.env.GRAFANA_RENDERER_HEIGHT?.trim() ||
        (grafanaCtx?.rendererHeight !== undefined ? String(grafanaCtx.rendererHeight) : ""));

    /**
     * `GRAFANA_MODE` precedence: explicit env / context override → otherwise auto-pick.
     *
     * Auto: when `GRAFANA_URL` resolves to non-empty (either operator-provided, local Docker
     * default for `stage=local`, or a created AMG workspace endpoint) → `AWS` (real HTTP). When
     * empty (no operator config + non-local stage + workspace creation disabled) → `MOCK`.
     */
    const grafanaModeContext = (this.node.tryGetContext("grafanaMode") as string | undefined)?.trim();
    const grafanaMode =
      (process.env.GRAFANA_MODE?.trim() || grafanaModeContext || (grafanaUrl ? "AWS" : "MOCK")).toUpperCase();

    /**
     * Anonymous Grafana is normal for `stage=local` (the Docker stack runs with
     * `GF_AUTH_ANONYMOUS_ENABLED=true`); flag it explicitly so the Lambda doesn't 503 when no
     * token is set. Non-local stages keep the AMG default of requiring a Bearer token.
     */
    const grafanaAllowAnonymous =
      process.env.GRAFANA_ALLOW_ANONYMOUS?.trim() ||
      (stage === "local" && !grafanaApiKeyInline && !grafanaApiKeySecretArn ? "1" : "");

    const visualizeEnv = {
      ...commonEnv,
      GRAFANA_MODE: grafanaMode,
      GRAFANA_URL: grafanaUrl,
      GRAFANA_API_KEY: grafanaApiKeyInline,
      GRAFANA_API_KEY_SECRET_ARN: grafanaApiKeySecretArn,
      GRAFANA_ALLOW_ANONYMOUS: grafanaAllowAnonymous,
      GRAFANA_DEFAULT_DASHBOARD_UID: grafanaDefaultDashboardUid,
      GRAFANA_DEFAULT_VARIABLE_NAME: grafanaDefaultVariableName,
      GRAFANA_DEFAULT_PANEL_ID: grafanaDefaultPanelId,
      GRAFANA_DEFAULT_DATASOURCE_UID: grafanaDefaultDatasourceUid,
      GRAFANA_DEFAULT_REGION: grafanaDefaultRegion,
      GRAFANA_RENDERER_ENABLED: grafanaRendererEnabled,
      GRAFANA_RENDERER_WIDTH: grafanaRendererWidth,
      GRAFANA_RENDERER_HEIGHT: grafanaRendererHeight,
    };

    const visualizeFn = new NodejsFunction(this, "GrafanaVisualizeFn", {
      ...lambdaDefaults,
      entry: path.join(__dirname, "..", "lambda", "grafana-visualize", "index.ts"),
      handler: "handler",
      description: `Build Grafana var-driven URL + optional render for a generated query (${stage})`,
      environment: visualizeEnv,
    });

    if (grafanaApiKeySecretArn) {
      /**
       * Grant runtime read access to the Grafana service-account token secret. Lambda lazy-imports
       * `@aws-sdk/client-secrets-manager` only when this ARN is set; the runtime SDK is provided by
       * the Node 20 managed runtime so no bundling is required.
       */
      const secret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        "GrafanaApiKeySecret",
        grafanaApiKeySecretArn,
      );
      secret.grantRead(visualizeFn);
    }

    /**
     * **LocalStack Community:** CloudFormation often records `AWS::ApiGatewayV2::*` as deployed
     * fallbacks with `PhysicalResourceId: unknown` — there is no working HTTP API. **REST (v1)**
     * is supported for real invokes on typical Community builds; routes and JSON bodies match the
     * HTTP API stage (`POST` + `AWS_PROXY` → same Lambda handlers).
     *
     * **AWS (`dev` | `test` | `prod`):** keep **HTTP API (v2)** — lower latency, native CORS, same
     * paths as local.
     */
    if (stage === "local") {
      const restApi = new apigateway.RestApi(this, "HumanQueryRestApi", {
        restApiName: `human-query-intent-${stage}`,
        description: "REST API v1 for LocalStack (HttpApi v2 not materialized on Community)",
        deployOptions: {
          stageName: "local",
          tracingEnabled: false,
        },
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: ["POST", "OPTIONS"],
          allowHeaders: ["Content-Type", "Authorization"],
        },
        cloudWatchRole: false,
      });

      const intentIntegration = new apigateway.LambdaIntegration(intentFn);
      const queryIntegration = new apigateway.LambdaIntegration(queryFn);
      const visualizeIntegration = new apigateway.LambdaIntegration(visualizeFn);

      restApi.root.addResource("intent").addMethod("POST", intentIntegration);
      const query = restApi.root.addResource("query");
      query.addResource("build").addMethod("POST", queryIntegration);
      restApi.root.addResource("visualize").addMethod("POST", visualizeIntegration);

      new CfnOutput(this, "HttpApiUrl", {
        value: restApi.url,
        description:
          "Base URL (REST API v1 on LocalStack) for POST /intent, POST /query/build, POST /visualize",
      });
    } else {
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

      httpApi.addRoutes({
        path: "/visualize",
        methods: [apigwv2.HttpMethod.POST],
        integration: new apigwIntegrations.HttpLambdaIntegration("GrafanaVisualizeIntegration", visualizeFn),
      });

      new CfnOutput(this, "HttpApiUrl", {
        value: httpApi.apiEndpoint,
        description: "Base URL (HTTP API v2) for POST /intent, POST /query/build, and POST /visualize",
      });
    }
    new CfnOutput(this, "Stage", { value: stage });
    new CfnOutput(this, "GrafanaMode", {
      value: grafanaMode,
      description: "Effective GRAFANA_MODE (AWS = call real Grafana; MOCK = URL builder only)",
    });
    new CfnOutput(this, "GrafanaBacking", {
      value: grafanaWorkspace.backing,
      description:
        "Where the Lambda's Grafana URL points: local-docker (stage=local), amg-created " +
        "(CfnWorkspace), amg-existing (operator URL), or none (MOCK).",
    });
    if (grafanaUrl) {
      new CfnOutput(this, "GrafanaUrl", {
        value: grafanaUrl,
        description: "Effective Grafana endpoint baked into the visualize Lambda's GRAFANA_URL env",
      });
    }
  }
}
