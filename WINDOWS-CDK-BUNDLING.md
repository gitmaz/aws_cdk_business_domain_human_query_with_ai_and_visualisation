# Windows: CDK synth / `NodejsFunction` bundling (PowerShell, CLR, esbuild)

On **Windows**, **`aws-cdk-lib/aws-lambda-nodejs.NodejsFunction`** often bundles TypeScript with **esbuild** by spawning:

```text
powershell.exe -NoProfile -Command … npx … esbuild …
```

If **Windows PowerShell 5.1** fails to start the **CLR** (common messages: **`Starting the CLR failed with HRESULT 0x80004005`**, **`Loading managed Windows PowerShell failed with error 800705af`**, or garbled output), **CDK cannot run esbuild** and **`cdk synth` / `cdk deploy`** fails during **“Bundling asset …”**.

This is a **host / PowerShell / .NET** issue, not a bug in this app’s Lambda code.

---

## Fix 1 (recommended): bundle inside Docker

CDK can run esbuild inside the **Lambda bundling Docker image**, which **does not** use your broken Windows PowerShell for that step.

1. Install and start **Docker Desktop** (daemon must be running).
2. Either:

**A — npm script (sets CDK context):**

```powershell
npm run synth:local:docker
```

**B — CDK CLI context (any stage):**

```powershell
npx cdk synth -c stage=local -c useDockerBundling=true
```

**C — environment variable (applies to all stages in that shell):**

```powershell
$env:CDK_FORCE_DOCKER_BUNDLING = "1"
npx cdk synth -c stage=local
```

This repo’s stack reads **`useDockerBundling`** / **`CDK_FORCE_DOCKER_BUNDLING`** via [`lib/bundling-flags.ts`](./lib/bundling-flags.ts) and sets **`forceDockerBundling: true`** on both **`NodejsFunction`**s.

For **`npm run deploy:local`**, set the same env **before** the command if you hit the error during deploy.

---

## Fix 2: repair or reset the Windows PowerShell stack

Try in order (stop when synth works):

1. **Windows Update** — install pending updates; reboot.
2. **System File Checker:** elevated CMD → `sfc /scannow`, then reboot.
3. **DISM** (if SFC reports corruption): elevated CMD →  
   `DISM /Online /Cleanup-Image /RestoreHealth`
4. **Antivirus / endpoint security** — temporarily exclude the repo folder and **`node_modules`** from real-time scanning (some products break short-lived `powershell` / `npx` processes).
5. **Use WSL2** for Node/CDK — run **`npm install`**, **`cdk synth`**, and deploy from a Linux filesystem under WSL (avoids Windows PowerShell for that toolchain path in many setups).

---

## Fix 3: confirm it is really the bundling step

Run with verbose CDK output:

```powershell
npx cdk synth -c stage=local --verbose 2>&1 | Select-String -Pattern "Bundling|esbuild|powershell|CLR"
```

If the failure is always right after **“Bundling asset …”** and mentions **powershell** / **esbuild** / **CLR**, this document applies.

---

## Related

- [`lib/business-domain-human-query-stack.ts`](./lib/business-domain-human-query-stack.ts) — Lambda **`bundling`** options  
- [LOCALSTACK.md](./LOCALSTACK.md) — deploy to LocalStack after synth succeeds
