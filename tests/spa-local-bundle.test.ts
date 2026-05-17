import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { spaPrebuiltLocalBundling } from "../lib/spa-local-bundle";

describe("spaPrebuiltLocalBundling", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    tmpRoots.length = 0;
  });

  function makeRoot(withDist: boolean): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "spa-bundle-"));
    tmpRoots.push(root);
    fs.mkdirSync(path.join(root, "lambda", "spa-static-host"), { recursive: true });
    fs.writeFileSync(path.join(root, "lambda", "spa-static-host", "handler.cjs"), "exports.handler = () => {};\n");
    if (withDist) {
      fs.mkdirSync(path.join(root, "spa", "dist"), { recursive: true });
      fs.writeFileSync(path.join(root, "spa", "dist", "index.html"), "<html></html>\n");
    }
    return root;
  }

  it("throws when spa/dist is missing", () => {
    const root = makeRoot(false);
    const bundler = spaPrebuiltLocalBundling(root, "lambda", "dev");
    expect(() => bundler.tryBundle(fs.mkdtempSync(path.join(os.tmpdir(), "spa-out-")))).toThrow(
      /spa\/dist is missing/,
    );
  });

  it("copies dist and handler for lambda target", () => {
    const root = makeRoot(true);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "spa-out-"));
    tmpRoots.push(out);
    const ok = spaPrebuiltLocalBundling(root, "lambda", "dev").tryBundle(out);
    expect(ok).toBe(true);
    expect(fs.readFileSync(path.join(out, "dist", "index.html"), "utf8")).toContain("<html>");
    expect(fs.existsSync(path.join(out, "index.js"))).toBe(true);
  });
});
