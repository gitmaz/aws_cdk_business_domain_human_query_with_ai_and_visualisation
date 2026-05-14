"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function isBinaryMime(ct) {
  return (
    ct.startsWith("image/") ||
    ct.startsWith("font/") ||
    ct === "application/octet-stream"
  );
}

function resolveFile(rawPath) {
  const decoded = decodeURIComponent(rawPath.split("?")[0] || "/");
  let rel = decoded.replace(/^\/+/, "");
  if (!rel || rel === "") rel = "index.html";
  if (rel.includes("..")) return { error: 400, message: "Invalid path" };

  const candidate = path.normalize(path.join(ROOT, rel));
  const rootNorm = path.normalize(ROOT + path.sep);
  if (!candidate.startsWith(rootNorm) && candidate !== path.normalize(ROOT)) {
    return { error: 403, message: "Forbidden" };
  }

  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return { filePath: candidate };
  }
  const indexHtml = path.join(ROOT, "index.html");
  if (fs.existsSync(indexHtml)) {
    return { filePath: indexHtml };
  }
  return { error: 404, message: "Not found" };
}

exports.handler = async function handler(event) {
  const rawPath = event.rawPath || "/";
  const resolved = resolveFile(rawPath);
  if (resolved.error) {
    return {
      statusCode: resolved.error,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: resolved.message || "Error",
    };
  }

  const bodyBuf = fs.readFileSync(resolved.filePath);
  const ct = contentType(resolved.filePath);
  const binary = isBinaryMime(ct);
  const relFromRoot = path.relative(ROOT, resolved.filePath).replace(/\\/g, "/");
  const cache =
    relFromRoot.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";

  return {
    statusCode: 200,
    headers: {
      "content-type": ct,
      "cache-control": cache,
    },
    body: binary ? bodyBuf.toString("base64") : bodyBuf.toString("utf8"),
    isBase64Encoded: binary,
  };
};
