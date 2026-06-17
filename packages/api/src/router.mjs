import { ANCHOR_FEE_WEI } from "./constants.mjs";
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
import {
  supabaseCreateOrLoginUser,
  supabaseDebitVirtualAnchor,
  supabaseGetUserByEmail,
  supabaseGetUserByToken,
  supabaseHealthCheck,
} from "./supabaseStore.mjs";
import { anchorStateOnChain, warmRelayer } from "./relayer.mjs";

function useSupabaseStore() {
  return String(process.env.NINK_STORE || "json").toLowerCase() === "supabase";
}

function useVirtualRailOnly() {
  return String(process.env.NINK_RAIL_MODE || "virtual").toLowerCase() === "virtual";
}

export function createStoreAdapter() {
  if (!useSupabaseStore()) {
    return {
      mode: "json",
      async healthExtra() {
        const relayer = await warmRelayer();
        return { relayer };
      },
      async createOrLoginUser(email) {
        const store = loadStore();
        const result = createOrLoginUser(store, email);
        saveStore(store);
        return result;
      },
      async getUserByToken(token) {
        return getUserByToken(loadStore(), token);
      },
      async getUserByEmail(email) {
        return getUserById(loadStore(), email);
      },
      async debitAnchor(user, stateHash, feeWei) {
        const store = loadStore();
        const { user: updatedUser, record } = anchorForUser(store, user.userId, stateHash, feeWei);
        saveStore(store);

        if (useVirtualRailOnly()) {
          finalizeAnchorRecord(record, {
            txHash: null,
            blockNumber: null,
            source: "nink-cloud-api-virtual",
            onChain: false,
          });
          saveStore(store);
          return {
            balance: updatedUser.balanceWei,
            proofId: record.id,
            feePaid: feeWei,
            stateHash,
            rail: "virtual",
            source: "nink-cloud-api-virtual",
            onChain: false,
            txHash: null,
            blockNumber: null,
          };
        }

        try {
          const chainResult = await anchorStateOnChain(stateHash);
          finalizeAnchorRecord(record, chainResult);
          saveStore(store);
          return {
            balance: updatedUser.balanceWei,
            proofId: record.id,
            feePaid: feeWei,
            stateHash,
            rail: "open_loop",
            source: chainResult.source,
            onChain: chainResult.onChain,
            txHash: chainResult.txHash,
            blockNumber: chainResult.blockNumber,
          };
        } catch (chainError) {
          updatedUser.balanceWei = (BigInt(updatedUser.balanceWei) + BigInt(feeWei)).toString();
          const idx = store.anchors.indexOf(record);
          if (idx >= 0) {
            store.anchors.splice(idx, 1);
          }
          saveStore(store);
          throw chainError;
        }
      },
    };
  }

  return {
    mode: "supabase",
    async healthExtra() {
      const database = await supabaseHealthCheck();
      if (useVirtualRailOnly()) {
        return { database, relayer: { ready: false, reason: "Rail 1 virtual mode — no on-chain relayer." } };
      }
      const relayer = await warmRelayer();
      return { database, relayer };
    },
    async createOrLoginUser(email) {
      return supabaseCreateOrLoginUser(email);
    },
    async getUserByToken(token) {
      return supabaseGetUserByToken(token);
    },
    async getUserByEmail(email) {
      return supabaseGetUserByEmail(email);
    },
    async debitAnchor(user, stateHash, feeWei) {
      return supabaseDebitVirtualAnchor(user, stateHash, feeWei);
    },
  };
}

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  if (typeof res.status === "function") {
    res.status(statusCode);
    for (const [key, value] of Object.entries(corsHeaders())) {
      res.setHeader(key, value);
    }
    res.send(body);
    return;
  }

  res.writeHead(statusCode, corsHeaders());
  res.end(body);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

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
  const header = String(req.headers.authorization || req.headers.Authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function resolvePathname(req) {
  const raw = req.url || "/";
  if (raw.startsWith("http")) {
    return new URL(raw).pathname;
  }
  return raw.split("?")[0] || "/";
}

function resolveSearchParams(req) {
  const raw = req.url || "/";
  if (raw.startsWith("http")) {
    return new URL(raw).searchParams;
  }
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  return new URL(query || "?", "http://local").searchParams;
}

async function resolveUser(adapter, req) {
  const token = readBearerToken(req);
  const tokenUser = await adapter.getUserByToken(token);
  if (tokenUser) {
    return tokenUser;
  }

  const userParam = resolveSearchParams(req).get("user");
  if (userParam) {
    return adapter.getUserByEmail(userParam);
  }

  return null;
}

export async function handleApiRequest(req, res) {
  const adapter = createStoreAdapter();
  const method = (req.method || "GET").toUpperCase();
  const pathname = resolvePathname(req);

  if (method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (method === "GET" && pathname === "/") {
    sendJson(res, 200, {
      status: "ok",
      service: "nink-api",
      docs: "GET /health · POST /v1/auth/login · GET /v1/accounting/parameters · POST /v1/blockchain/anchor",
    });
    return;
  }

  if (method === "GET" && pathname === "/health") {
    const extra = await adapter.healthExtra();
    sendJson(res, 200, {
      status: "ok",
      service: "nink-api",
      store: adapter.mode,
      railMode: useVirtualRailOnly() ? "virtual" : "open_loop",
      ...extra,
    });
    return;
  }

  if (method === "POST" && pathname === "/v1/auth/login") {
    try {
      const body = await readJsonBody(req);
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) {
        sendJson(res, 400, { status: "ERROR", message: "Enter a valid email address." });
        return;
      }

      const { user, sessionToken, expiresAt } = await adapter.createOrLoginUser(email);
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

  if (method === "GET" && pathname === "/v1/accounting/parameters") {
    const user = await resolveUser(adapter, req);
    if (!user) {
      sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
      return;
    }

    sendJson(res, 200, {
      balance: user.balanceWei,
      feeRequirement: ANCHOR_FEE_WEI,
      source: "nink-cloud-api",
      userId: user.userId,
      rail: user.rail || "closed_loop",
    });
    return;
  }

  if (method === "POST" && pathname === "/v1/blockchain/anchor") {
    try {
      const body = await readJsonBody(req);
      const user = await resolveUser(adapter, req);
      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const stateHash = body.stateHash;
      const feeWei = String(body.tokenFeeBurned || ANCHOR_FEE_WEI);
      const result = await adapter.debitAnchor(user, stateHash, feeWei);

      sendJson(res, 200, {
        status: "SUCCESS",
        txHash: result.txHash,
        proofId: result.proofId,
        blockNumber: result.blockNumber,
        source: result.source,
        onChain: result.onChain,
        balance: result.balance,
        feePaid: result.feePaid,
        stateHash: result.stateHash,
        rail: result.rail,
      });
    } catch (error) {
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
    return;
  }

  sendJson(res, 404, { status: "ERROR", message: "Not found." });
}
