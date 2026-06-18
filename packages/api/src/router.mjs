import { ANCHOR_FEE_WEI } from "./constants.mjs";
import { weiToCredits, PACKAGE_FEES } from "./credits.mjs";
import { InvalidCredentialsError, PasswordValidationError } from "./password.mjs";
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
  SignupConflictError,
  SignupVerificationError,
  supabaseCompleteSignup,
  supabaseSendSignupVerification,
} from "./signupStore.mjs";
import { renderSignupPage } from "./signupPage.mjs";
import {
  supabaseCreateOrLoginUser,
  supabaseDebitVirtualAnchor,
  supabaseGetUserByEmail,
  supabaseGetUserByToken,
  supabaseHealthCheck,
} from "./supabaseStore.mjs";
import { anchorStateOnChain, warmRelayer } from "./relayer.mjs";
import {
  createEvidencePackage,
  downloadEvidenceReport,
  InsufficientBalanceError,
  PackageAccessError,
  verifyEvidencePackage,
  viewEvidencePackage,
} from "./packagesStore.mjs";
import {
  getPackageAccessStatus,
  requestPackageAccess,
  respondToPackageAccessRequest,
} from "./packageAccessStore.mjs";
import { AccessRequestError } from "./packageErrors.mjs";
import { renderAccessRequestResultPage } from "./accessRequestPage.mjs";
import { renderExtensionInstallPage } from "./extensionInstallPage.mjs";
import { tryServeExtensionFile } from "./extensionStatic.mjs";

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
      async createOrLoginUser(email, password) {
        const store = loadStore();
        const result = createOrLoginUser(store, email, password);
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
    async createOrLoginUser(email, password) {
      return supabaseCreateOrLoginUser(email, password);
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

export function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  const headers = { ...corsHeaders(), ...extraHeaders };
  if (typeof res.status === "function") {
    res.status(statusCode);
    for (const [key, value] of Object.entries(headers)) {
      res.setHeader(key, value);
    }
    res.send(body);
    return;
  }

  res.writeHead(statusCode, headers);
  res.end(body);
}

function privateResponseHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  };
}

function accountingPayload(user) {
  return {
    balance: user.balanceWei,
    balanceCredits: weiToCredits(user.balanceWei),
    feeRequirement: ANCHOR_FEE_WEI,
    feeCredits: weiToCredits(ANCHOR_FEE_WEI),
    packageFees: PACKAGE_FEES,
    source: "nink-cloud-api",
    userId: user.userId,
    rail: user.rail || "closed_loop",
  };
}

function htmlHeaders() {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

export function sendHtml(res, statusCode, html) {
  if (typeof res.status === "function") {
    res.status(statusCode);
    for (const [key, value] of Object.entries(htmlHeaders())) {
      res.setHeader(key, value);
    }
    res.send(html);
    return;
  }

  res.writeHead(statusCode, htmlHeaders());
  res.end(html);
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
      docs: "GET /health · GET /signup · GET /extension/install · GET /extension/* · GET /access-request/respond · POST /v1/packages/request-access · GET /v1/packages/access-status · POST /v1/auth/signup/send-code · POST /v1/auth/signup/complete · POST /v1/auth/login · GET /v1/accounting/parameters · POST /v1/blockchain/anchor",
    });
    return;
  }

  if (method === "GET" && pathname === "/signup") {
    sendHtml(res, 200, renderSignupPage());
    return;
  }

  if (method === "GET" && pathname === "/extension/install") {
    sendHtml(res, 200, renderExtensionInstallPage());
    return;
  }

  if (method === "GET" && pathname.startsWith("/extension/")) {
    const file = tryServeExtensionFile(pathname);
    if (file) {
      const headers = {
        "Content-Type": file.contentType,
        "Cache-Control": "public, max-age=300",
      };
      if (typeof res.status === "function") {
        res.status(200);
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value);
        }
        res.send(file.body);
      } else {
        res.writeHead(200, headers);
        res.end(file.body);
      }
      return;
    }
  }

  if (method === "GET" && pathname === "/access-request/respond") {
    if (!useSupabaseStore()) {
      sendHtml(
        res,
        501,
        renderAccessRequestResultPage({ message: "Access requests require NINK_STORE=supabase." })
      );
      return;
    }

    try {
      const token = resolveSearchParams(req).get("token");
      const result = await respondToPackageAccessRequest(token);
      sendHtml(res, 200, renderAccessRequestResultPage(result));
    } catch (error) {
      sendHtml(res, 400, renderAccessRequestResultPage({ message: error.message }));
    }
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

  if (method === "POST" && pathname === "/v1/auth/signup/send-code") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Signup requires NINK_STORE=supabase." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const result = await supabaseSendSignupVerification(body.email);
      sendJson(res, 200, { status: "SUCCESS", ...result });
    } catch (error) {
      if (error instanceof SignupConflictError) {
        sendJson(res, 409, { status: "ERROR", message: error.message });
        return;
      }
      const status = /wait a minute/i.test(error.message) ? 429 : 400;
      sendJson(res, status, { status: "ERROR", message: error.message });
    }
    return;
  }

  if (method === "POST" && pathname === "/v1/auth/signup/complete") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Signup requires NINK_STORE=supabase." });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const result = await supabaseCompleteSignup(body.email, body.code, body.password);
      sendJson(res, 200, {
        status: "SUCCESS",
        user: {
          userId: result.user.userId,
          email: result.user.email,
          displayName: result.user.displayName,
        },
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt,
        balance: result.balance,
        balanceCredits: weiToCredits(result.balance),
        feeRequirement: result.feeRequirement,
        feeCredits: weiToCredits(result.feeRequirement),
        signupBonusWei: result.signupBonusWei,
      });
    } catch (error) {
      if (error instanceof SignupConflictError) {
        sendJson(res, 409, { status: "ERROR", message: error.message });
        return;
      }
      if (error instanceof SignupVerificationError) {
        sendJson(res, 400, { status: "ERROR", message: error.message });
        return;
      }
      if (error instanceof PasswordValidationError) {
        sendJson(res, 400, { status: "ERROR", message: error.message, details: error.messages });
        return;
      }
      sendJson(res, 500, { status: "ERROR", message: error.message });
    }
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

      const { user, sessionToken, expiresAt } = await adapter.createOrLoginUser(
        email,
        body.password
      );
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
        balanceCredits: weiToCredits(user.balanceWei),
        feeRequirement: ANCHOR_FEE_WEI,
        feeCredits: weiToCredits(ANCHOR_FEE_WEI),
      });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        sendJson(res, 401, { status: "ERROR", message: error.message });
        return;
      }
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

    sendJson(res, 200, accountingPayload(user));
    return;
  }

  if (method === "POST" && pathname === "/v1/packages/create") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Packages require NINK_STORE=supabase." });
      return;
    }

    try {
      const user = await resolveUser(adapter, req);
      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const body = await readJsonBody(req);
      const result = await createEvidencePackage(user, {
        title: body.title,
        payload: body.payload,
        stateHash: body.stateHash,
      });

      sendJson(res, 200, { status: "SUCCESS", ...result });
    } catch (error) {
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
    return;
  }

  if (method === "GET" && pathname === "/v1/packages/access-status") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Packages require NINK_STORE=supabase." });
      return;
    }

    try {
      const user = await resolveUser(adapter, req);
      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const packageId =
        resolveSearchParams(req).get("packageId") ||
        resolveSearchParams(req).get("package_id");
      const result = await getPackageAccessStatus(user, packageId);
      sendJson(res, 200, { status: "SUCCESS", ...result });
    } catch (error) {
      if (error instanceof PackageAccessError) {
        sendJson(res, 403, { status: "ERROR", message: error.message });
        return;
      }
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
    return;
  }

  if (method === "POST" && pathname === "/v1/packages/request-access") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Packages require NINK_STORE=supabase." });
      return;
    }

    try {
      const user = await resolveUser(adapter, req);
      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const body = await readJsonBody(req);
      const result = await requestPackageAccess(
        user,
        body.packageId || body.package_id,
        body.message
      );
      sendJson(res, 200, { status: "SUCCESS", ...result });
    } catch (error) {
      if (error instanceof AccessRequestError) {
        sendJson(res, 409, { status: "ERROR", message: error.message });
        return;
      }
      if (error instanceof PackageAccessError) {
        sendJson(res, 403, { status: "ERROR", message: error.message });
        return;
      }
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
    return;
  }

  if (method === "POST" && pathname === "/v1/packages/view") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Packages require NINK_STORE=supabase." });
      return;
    }

    try {
      const user = await resolveUser(adapter, req);
      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const body = await readJsonBody(req);
      const result = await viewEvidencePackage(user, body.packageId || body.package_id);
      sendJson(
        res,
        200,
        {
          status: "SUCCESS",
          ...result,
        },
        privateResponseHeaders()
      );
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        sendJson(res, 402, { status: "ERROR", message: error.message });
        return;
      }
      if (error instanceof PackageAccessError) {
        sendJson(res, 403, { status: "ERROR", message: error.message });
        return;
      }
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
    return;
  }

  if (method === "POST" && pathname === "/v1/packages/verify") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Packages require NINK_STORE=supabase." });
      return;
    }

    try {
      const user = await resolveUser(adapter, req);
      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const body = await readJsonBody(req);
      const result = await verifyEvidencePackage(user, body.packageId || body.package_id);
      sendJson(res, 200, { status: "SUCCESS", ...result });
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        sendJson(res, 402, { status: "ERROR", message: error.message });
        return;
      }
      if (error instanceof PackageAccessError) {
        sendJson(res, 403, { status: "ERROR", message: error.message });
        return;
      }
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
    return;
  }

  if (method === "POST" && pathname === "/v1/packages/download-report") {
    if (!useSupabaseStore()) {
      sendJson(res, 501, { status: "ERROR", message: "Packages require NINK_STORE=supabase." });
      return;
    }

    try {
      const user = await resolveUser(adapter, req);
      if (!user) {
        sendJson(res, 401, { status: "ERROR", message: "Sign in required." });
        return;
      }

      const body = await readJsonBody(req);
      const result = await downloadEvidenceReport(user, body.packageId || body.package_id);
      sendJson(res, 200, { status: "SUCCESS", ...result }, privateResponseHeaders());
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        sendJson(res, 402, { status: "ERROR", message: error.message });
        return;
      }
      if (error instanceof PackageAccessError) {
        sendJson(res, 403, { status: "ERROR", message: error.message });
        return;
      }
      sendJson(res, 400, { status: "ERROR", message: error.message });
    }
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
