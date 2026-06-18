import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = path.join(__dirname, "..", "public", "extension");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ps1": "text/plain; charset=utf-8",
  ".sh": "text/plain; charset=utf-8",
};

export function extensionPublicRoot() {
  return EXTENSION_ROOT;
}

export function tryServeExtensionFile(pathname) {
  if (!pathname.startsWith("/extension/")) {
    return null;
  }

  let rel = pathname.slice("/extension/".length);
  if (!rel || rel === "install") {
    return null;
  }

  rel = decodeURIComponent(rel);
  if (rel.includes("..")) {
    return null;
  }

  const filePath = path.resolve(EXTENSION_ROOT, rel);
  if (!filePath.startsWith(path.resolve(EXTENSION_ROOT))) {
    return null;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();
  return {
    filePath,
    contentType: MIME[ext] || "application/octet-stream",
    body: fs.readFileSync(filePath),
  };
}
