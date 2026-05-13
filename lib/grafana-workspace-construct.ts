import * as grafana from "aws-cdk-lib/aws-grafana";
import { Construct } from "constructs";

import type { StageId } from "./stage-config";

/**
 * Resolves the Grafana endpoint the visualize Lambda should target, with **stage-aware** defaults
 * matching `code_generation_context_2.md` §"Grafana instance setup":
 *
 * - **`stage=local`** → local Docker Grafana (`http://host.docker.internal:3000` by default;
 *   override to `http://grafana:3000` if LocalStack and Grafana share the `human-query-net`
 *   Docker network). No CDK resources created — the operator runs `npm run grafana:local:up`.
 *
 * - **`stage=dev|test|prod`** → either point at an existing AMG workspace URL provided via env /
 *   context, **or** create a new **Amazon Managed Grafana** workspace via `CfnWorkspace` when
 *   `humanQuery.grafana.aws.createWorkspace: true` is set in `cdk.json` (or `-c
 *   createGrafanaWorkspace=true`). When creating, IAM Identity Center must already be enabled at
 *   the org level (one-time manual step — see README).
 */
export interface GrafanaContextAws {
  /** When `true`, create an AMG `CfnWorkspace` and use its endpoint as `GRAFANA_URL`. */
  createWorkspace?: boolean;
  workspaceName?: string;
  description?: string;
  /**
   * Authentication providers. AMG supports `AWS_SSO` and / or `SAML`. Default: `AWS_SSO`.
   * AWS_SSO requires IAM Identity Center enabled in the account/org — see README.
   */
  authenticationProviders?: Array<"AWS_SSO" | "SAML">;
  /** Default `SERVICE_MANAGED`. Use `CUSTOMER_MANAGED` to BYO IAM role. */
  permissionType?: "SERVICE_MANAGED" | "CUSTOMER_MANAGED";
  /** Default `["CLOUDWATCH", "XRAY"]`. */
  dataSources?: string[];
  /** Default `["SNS"]` (empty array is also accepted to disable). */
  notificationDestinations?: string[];
  /** Workspace IAM role ARN when `permissionType=CUSTOMER_MANAGED`. */
  roleArn?: string;
}

export interface GrafanaContext {
  /** Operator-provided URL (any stage). Wins over `local.url` / created AMG endpoint. */
  url?: string;
  /** Service-account token. Empty/missing in local stage falls back to anonymous Grafana. */
  apiKeySecretArn?: string;
  /** `cdk.json` shape for the local Docker Grafana stack. */
  local?: { url?: string; dockerNetworkAlias?: string };
  aws?: GrafanaContextAws;
}

export interface GrafanaWorkspaceConstructProps {
  stage: StageId;
  context: GrafanaContext | undefined;
  /**
   * Optional env override (`process.env.GRAFANA_URL`). Wins over everything when set — useful for
   * one-shot local overrides like running the LocalStack-deployed Lambda against AMG.
   */
  envUrl?: string;
}

export class GrafanaWorkspaceConstruct extends Construct {
  /** Effective endpoint baked into the Lambda's `GRAFANA_URL` env. */
  public readonly endpoint: string;

  /** Effective backing kind — for stack outputs / diagnostics. */
  public readonly backing: "local-docker" | "amg-created" | "amg-existing" | "none";

  /** Created AMG workspace (only when `aws.createWorkspace: true` on non-local stages). */
  public readonly workspace?: grafana.CfnWorkspace;

  constructor(scope: Construct, id: string, props: GrafanaWorkspaceConstructProps) {
    super(scope, id);

    const { stage, context, envUrl } = props;
    const operatorUrl = (envUrl ?? context?.url ?? "").trim();

    if (operatorUrl) {
      /** Explicit URL always wins, regardless of stage. */
      this.endpoint = operatorUrl;
      this.backing = stage === "local" ? "local-docker" : "amg-existing";
      return;
    }

    if (stage === "local") {
      /**
       * Default to **`host.docker.internal`** — works on Docker Desktop (Mac/Windows). On Linux,
       * either set `local.dockerNetworkAlias=grafana` (when LocalStack is attached to the
       * `human-query-net` bridge) or set an explicit URL via env / context.
       */
      const fallbackLocal = context?.local?.url?.trim() || "http://host.docker.internal:3000";
      this.endpoint = fallbackLocal;
      this.backing = "local-docker";
      return;
    }

    /** Non-local stage: optionally create an AMG workspace. */
    if (context?.aws?.createWorkspace) {
      const cfg = context.aws;
      /** Empty string in `cdk.json` is treated as "use default" (matches operator intent). */
      const name = cfg.workspaceName?.trim() || `human-query-${stage}`;
      const description = cfg.description?.trim() || `AI human-query observability (${stage})`;
      const workspace = new grafana.CfnWorkspace(this, "Workspace", {
        name,
        description,
        accountAccessType: "CURRENT_ACCOUNT",
        authenticationProviders:
          cfg.authenticationProviders && cfg.authenticationProviders.length > 0
            ? cfg.authenticationProviders
            : ["AWS_SSO"],
        permissionType: cfg.permissionType ?? "SERVICE_MANAGED",
        dataSources:
          cfg.dataSources && cfg.dataSources.length > 0 ? cfg.dataSources : ["CLOUDWATCH", "XRAY"],
        notificationDestinations: cfg.notificationDestinations ?? ["SNS"],
        ...(cfg.permissionType === "CUSTOMER_MANAGED" && cfg.roleArn ? { roleArn: cfg.roleArn } : {}),
      });

      this.workspace = workspace;
      /**
       * `attrEndpoint` is `g-xxxxxx.grafana-workspace.<region>.amazonaws.com` (host only). The
       * Lambda expects a full `https://...` URL. Service-managed permissions create CloudWatch +
       * X-Ray read roles automatically; CUSTOMER_MANAGED roles must be passed in via `roleArn`.
       */
      this.endpoint = `https://${workspace.attrEndpoint}`;
      this.backing = "amg-created";
      return;
    }

    /**
     * Neither URL provided nor workspace creation requested — visualize Lambda will run in MOCK
     * mode (URL builder only) until the operator wires this up.
     */
    this.endpoint = "";
    this.backing = "none";
  }
}
