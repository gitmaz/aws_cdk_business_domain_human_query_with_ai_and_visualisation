#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BusinessDomainHumanQueryStack } from "../lib/business-domain-human-query-stack";

const app = new cdk.App();
const stage = (app.node.tryGetContext("stage") ?? "dev") as string;

const env =
  stage === "dev"
    ? { account: "000000000000", region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" }
    : {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
      };

new BusinessDomainHumanQueryStack(app, `BusinessDomainHumanQuery-${stage}`, {
  stage,
  env,
});
