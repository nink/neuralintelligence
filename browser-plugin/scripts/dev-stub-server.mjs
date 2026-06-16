import http from "node:http";
import {
  LOCAL_DEV_ACCOUNTING,
  createMockAnchorReceipt,
} from "../src/utils/devStubs.js";
import { formatTokenForDisplay } from "../src/utils/tokenMath.js";

/** Legacy stub — superseded by packages/api (port 8787). Kept on 8786 to avoid conflicts. */
const PORT = Number(process.env.NINK_STUB_PORT || 8786);
const HOST = process.env.NINK_STUB_HOST || "127.0.0.1";

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/accounting/parameters") {
    sendJson(res, 200, {
      balance: LOCAL_DEV_ACCOUNTING.balance,
      feeRequirement: LOCAL_DEV_ACCOUNTING.feeRequirement,
      source: "localhost-dev-stub",
      displayBalance: formatTokenForDisplay(LOCAL_DEV_ACCOUNTING.balance),
      displayFee: formatTokenForDisplay(LOCAL_DEV_ACCOUNTING.feeRequirement),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/blockchain/anchor") {
    try {
      await readJsonBody(req);
      sendJson(res, 200, createMockAnchorReceipt());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.warn("DEPRECATED: use packages/api on port 8787 instead of this legacy stub.");
  console.log(`NINK legacy stub server listening on http://${HOST}:${PORT}`);
  console.log(`  Balance: ${formatTokenForDisplay(LOCAL_DEV_ACCOUNTING.balance)} NINK`);
  console.log(`  Fee: ${formatTokenForDisplay(LOCAL_DEV_ACCOUNTING.feeRequirement)} NINK`);
});
