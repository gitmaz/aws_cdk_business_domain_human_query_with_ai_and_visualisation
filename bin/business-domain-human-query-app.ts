#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BusinessDomainHumanQueryStack } from "../lib/business-domain-human-query-stack";
import { parseStage, stackEnvForStage } from "../lib/stage-config";

const app = new cdk.App();
const stage = parseStage(app.node.tryGetContext("stage") as string | undefined);
const env = stackEnvForStage(stage);

new BusinessDomainHumanQueryStack(app, `BusinessDomainHumanQuery-${stage}`, {
  stage,
  env,
  description: `Semantic analytics API (intent + query builders) — ${stage}`,
});
