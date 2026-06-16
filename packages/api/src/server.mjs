import http from "node:http";
import { ANCHOR_FEE_WEI, HOST, PORT } from "./constants.mjs";
import { anchorStateOnChain, warmRelayer } from "./relayer.mjs";
import {
  anchorForUser,
  createOrLoginUser,
  finalizeAnchorRecord,
  getUserById,
  getUserByToken,
  isValidEmail,
  loadStore,
  normalizeEmail,
  saveStore,
} from "./store.mjs";

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function readBearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function resolveUserFromRequest(req, url) {
  const store = loadStore();
  const token = readBearerToken(req);
  const tokenUser = getUserByToken(store, token);
  if (tokenUser) {
    return { store, user: tokenUser, auth: "token" };
  }

  const userParam = url.searchParams.get("user");
  if (userParam) {
    const user = getUserById(store, userParam);
    if (user) {
      return { store, user, auth: "user-query" };
    }
  }

  return { store, user: null, auth: null };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    const relayer = await warmRelayer();
    sendJson(res, 200, {
      status: "ok",
      service: "nink-api",
      relayer,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/auth/login") {
    try {
      const body = await readJsonBody(req);
      const email = normalizeEmail(body.email);

      if (!isValidEmail(email)) {
        sendJson(res, 400, { status: "ERROR", message: "Enter a valid email address." });
        return;
      }

      const store = loadStore();
      const { user, sessionToken, expiresAt } = createOrLoginUser(store, email);
      saveStore(store);

      sendJson(res, 200, {
        status: "SUCCESS",
        user: {
          userId: user.userId,
          email: user.email,
          displayName: user.displayName,
        },
        sessionToken,
        expiresAt,
        balance: user.balanceWei,
        feeRequirement: ANCHOR_FEE_WEI,
      });
    } catch (error) {
      sendJson(res, 500, { status: "ERROR", message: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/accounting/parameters") {
    const { store, user } = resolveUserFromRequest(req, url);

    if (!user) {
      sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
      return;
    }

    sendJson(res, 200, {
      balance: user.balanceWei,
      feeRequirement: ANCHOR_FEE_WEI,
      source: "nink-cloud-api",
      userId: user.userId,
    });
    saveStore(store);
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/blockchain/anchor") {
    try {
      const body = await readJsonBody(req);
      const { store, user } = resolveUserFromRequest(req, url);

      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const stateHash = body.stateHash;
      const feeWei = String(body.tokenFeeBurned || ANCHOR_FEE_WEI);

      const { user: updatedUser, record } = anchorForUser(store, user.userId, stateHash, feeWei);
      saveStore(store);

      try {
        const chainResult = await anchorStateOnChain(stateHash);
        finalizeAnchorRecord(record, chainResult);
        saveStore(store);

        sendJson(res, 200, {
          status: "SUCCESS",
          txHash: chainResult.txHash,
          blockNumber: chainResult.blockNumber,
          source: chainResult.source,
          onChain: chainResult.onChain,
          balance: updatedUser.balanceWei,
          feePaid: feeWei,
          stateHash,
        });
      } catch (chainError) {
        updatedUser.balanceWei = (BigInt(updatedUser.balanceWei) + BigInt(feeWei)).toString();
        const idx = store.anchors.indexOf(record);
        if (idx >= 0) {
          store.anchors.splice(idx, 1);
        }
        saveStore(store);
        sendJson(res, 502, {
          status: "ERROR",
          message: `Anchor failed after balance deduction rollback: ${chainError.message}`,
        });
      }
    } catch (error) {
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
    return;
  }

  sendJson(res, 404, { status: "ERROR", message: "Not found." });
});

warmRelayer().then((relayer) => {
  server.listen(PORT, HOST, () => {
    console.log(`NINK API listening on http://${HOST}:${PORT}`);
    console.log(`  Store: ${process.env.NINK_API_STORE || "(default packages/api/data/dev-store.json)"}`);
    if (relayer.ready) {
      console.log(`  Relayer: ${relayer.relayer} → registry ${relayer.registry}`);
    } else {
      console.log(`  Relayer: offline (${relayer.reason}) — anchors recorded off-chain only`);
    }
  });
});
