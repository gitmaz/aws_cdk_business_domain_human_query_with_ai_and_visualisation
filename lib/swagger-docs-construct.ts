import * as path from "path";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwIntegrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { CfnOutput, Duration } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface SwaggerDocsConstructProps {
  stage: string;
  /** Deployed API base (no trailing slash) — used in OpenAPI `servers` for Try it out. */
  apiPublicBaseUrl: string;
  lambdaDefaults: {
    runtime: lambda.Runtime;
    timeout: Duration;
    memorySize: number;
    tracing: lambda.Tracing;
    bundling: Record<string, unknown>;
  };
  restApi?: apigateway.RestApi;
  httpApi?: apigwv2.HttpApi;
}

/**
 * Lambda-hosted Swagger UI + OpenAPI JSON on the same API as the business handlers,
 * plus a dedicated Function URL for direct browser access to the docs Lambda.
 */
export class SwaggerDocsConstruct extends Construct {
  readonly fn: NodejsFunction;
  readonly functionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: SwaggerDocsConstructProps) {
    super(scope, id);

    const apiBase = props.apiPublicBaseUrl.replace(/\/+$/, "");

    this.fn = new NodejsFunction(this, "SwaggerDocsFn", {
      ...props.lambdaDefaults,
      entry: path.join(__dirname, "..", "lambda", "swagger-docs", "index.ts"),
      handler: "handler",
      description: `Swagger UI + OpenAPI for human-query API (${props.stage})`,
      environment: {
        STAGE: props.stage,
        API_PUBLIC_BASE_URL: apiBase,
      },
      bundling: {
        ...props.lambdaDefaults.bundling,
        loader: { ".json": "json" },
      },
    });

    this.functionUrl = this.fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    if (props.restApi) {
      const integration = new apigateway.LambdaIntegration(this.fn);
      props.restApi.root.addResource("docs").addMethod("GET", integration);
      props.restApi.root.addResource("openapi.json").addMethod("GET", integration);
    }

    if (props.httpApi) {
      const integration = new apigwIntegrations.HttpLambdaIntegration("SwaggerDocsIntegration", this.fn);
      props.httpApi.addRoutes({
        path: "/docs",
        methods: [apigwv2.HttpMethod.GET],
        integration,
      });
      props.httpApi.addRoutes({
        path: "/openapi.json",
        methods: [apigwv2.HttpMethod.GET],
        integration,
      });
    }

    const docsOnApi = apiBase ? `${apiBase}/docs` : "/docs";

    new CfnOutput(this, "SwaggerDocsUrl", {
      value: docsOnApi,
      description: "Swagger UI on the API (GET /docs; spec at GET /openapi.json)",
    });

    new CfnOutput(this, "SwaggerDocsLambdaUrl", {
      value: this.functionUrl.url,
      description: "Lambda Function URL — same Swagger UI handler (Try it out still uses HttpApiUrl)",
    });
  }
}
