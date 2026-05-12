import { execFileSync } from "node:child_process";

const stage = "local";
const account = "000000000000";
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

const defaultHostEndpoint = "http://127.0.0.1:4566";

function resolvedEndpoint() {
  return process.env.AWS_ENDPOINT_URL ?? defaultHostEndpoint;
}

function resolvedS3Endpoint() {
  return process.env.AWS_ENDPOINT_URL_S3 ?? resolvedEndpoint();
}

function hostLocalstackEnv(endpoint) {
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? "test",
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? "test",
    AWS_DEFAULT_REGION: region,
    CDK_DEFAULT_ACCOUNT: account,
    CDK_DEFAULT_REGION: region,
    AWS_ENDPOINT_URL: endpoint,
    AWS_ENDPOINT_URL_S3: resolvedS3Endpoint(),
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_USE_PATH_STYLE_ENDPOINT: "true",
    AWS_S3_FORCE_PATH_STYLE: "1",
  };
}

const ep = resolvedEndpoint();
const env = hostLocalstackEnv(ep);
const isWin = process.platform === "win32";

function run(bin, args) {
  if (!isWin) {
    execFileSync(bin, args, { stdio: "inherit", env });
    return;
  }
  const cmd = [bin, ...args].join(" ");
  execFileSync("cmd.exe", ["/d", "/s", "/c", cmd], { stdio: "inherit", env });
}

run("npm", ["run", "build"]);
run("npx", [
  "-p",
  "aws-cdk@2.1121.0",
  "cdk",
  "destroy",
  "--all",
  "-c",
  `stage=${stage}`,
  "--force",
]);

console.log("LocalStack destroy initiated/completed (stage=local).");
