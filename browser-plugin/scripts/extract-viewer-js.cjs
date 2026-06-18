const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "viewer.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts[scripts.length - 1];

const boot = [
  "document.addEventListener('dragover', function (e) {",
  "  e.preventDefault();",
  "  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';",
  "}, true);",
  "document.addEventListener('drop', function (e) { e.preventDefault(); }, true);",
  "",
].join("\n");

fs.writeFileSync(path.join(root, "viewer-app.js"), `${boot}\n${main}`);

let out = html.replace(
  /<script>\s*document\.addEventListener\("dragover"[\s\S]*?<\/script>\s*/,
  ""
);
out = out.replace(
  /<script>[\s\S]*?<\/script>\s*<\/body>/,
  '  <script src="viewer-app.js"></script>\n</body>'
);
fs.writeFileSync(htmlPath, out);
console.log("Wrote viewer-app.js", fs.statSync(path.join(root, "viewer-app.js")).size, "bytes");
