/**
 * Copy browser-plugin sources to public/extension/ for hosting at ni.nink.com/extension/
 * Run before deploy: npm run sync-extension
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.join(__dirname, "..");
const SOURCE = path.join(API_ROOT, "..", "..", "browser-plugin");
const DEST = path.join(API_ROOT, "public", "extension");

const SKIP_DIRS = new Set(["node_modules", "scripts", ".git"]);
const SKIP_FILES = new Set([
  "package-lock.json",
  "package.json",
  "README.md",
  "viewer-full.html",
  "viewer-pre-credits.html",
  "pick-files.html",
  "wallet-setup.html",
]);

function shouldSkip(relPath, isDir) {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  if (parts.some((part) => SKIP_DIRS.has(part))) {
    return true;
  }
  if (!isDir && SKIP_FILES.has(parts[parts.length - 1])) {
    return true;
  }
  return false;
}

function copyRecursive(srcDir, destDir, rel = "") {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (shouldSkip(relPath, entry.isDirectory())) {
      continue;
    }

    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyRecursive(src, dest, relPath);
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }
}

function walkFiles(dir, rel = "", out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, relPath, out);
    } else {
      out.push(relPath.replace(/\\/g, "/"));
    }
  }
  return out;
}

function writeInstallScripts(baseUrl) {
  const ps1 = `# NINK extension — copy files from ${baseUrl}/extension/ to a local folder for Chrome
$ErrorActionPreference = "Stop"
$Base = "${baseUrl}/extension"
$Dest = Join-Path $env:USERPROFILE "nink-extension"
Write-Host "Downloading NINK extension to $Dest ..."
$files = Invoke-RestMethod "$Base/filelist.json"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
foreach ($rel in $files) {
  $url = "$Base/$rel"
  $out = Join-Path $Dest $rel
  $parent = Split-Path $out -Parent
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
}
Write-Host ""
Write-Host "Done. Next:"
Write-Host "  1. Open chrome://extensions in Chrome"
Write-Host "  2. Turn ON Developer mode (top right)"
Write-Host "  3. Click Load unpacked and select:"
Write-Host "     $Dest"
`;

  const sh = `#!/usr/bin/env bash
set -euo pipefail
DEST="$HOME/nink-extension"
echo "Downloading NINK extension to $DEST ..."
mkdir -p "$DEST"
curl -fsSL "${baseUrl}/extension/filelist.json" | python3 -c "
import json, os, sys, urllib.request
base = '${baseUrl}/extension'
dest = os.path.expanduser('~/nink-extension')
for rel in json.load(sys.stdin):
    url = base + '/' + rel
    out = os.path.join(dest, rel)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    urllib.request.urlretrieve(url, out)
    print('  ', rel)
"
echo ""
echo "Done. Open chrome://extensions → Developer mode ON → Load unpacked →"
echo "  $DEST"
`;

  fs.writeFileSync(path.join(DEST, "install.ps1"), ps1, "utf8");
  fs.writeFileSync(path.join(DEST, "install.sh"), sh, { mode: 0o755 });
}

function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error("browser-plugin not found at", SOURCE);
    process.exit(1);
  }

  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });
  copyRecursive(SOURCE, DEST);

  const files = walkFiles(DEST).filter(
    (f) => f !== "filelist.json" && f !== "install.ps1" && f !== "install.sh"
  );
  fs.writeFileSync(
    path.join(DEST, "filelist.json"),
    JSON.stringify(files, null, 2),
    "utf8"
  );

  const baseUrl = process.env.NINK_PUBLIC_BASE_URL || "https://ni.nink.com";
  writeInstallScripts(baseUrl);

  console.log(`Synced ${files.length} files to public/extension/`);
}

main();
