import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ANCHOR_FEE_WEI,
  INITIAL_USER_BALANCE_WEI,
  SESSION_TTL_MS,
  STORE_PATH,
} from "./constants.mjs";

function emptyStore() {
  return {
    version: 1,
    users: {},
    anchors: [],
  };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(emptyStore(), null, 2));
  }
}

export function loadStore() {
  ensureStoreFile();
  const raw = fs.readFileSync(STORE_PATH, "utf8");
  return JSON.parse(raw);
}

export function saveStore(store) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  const normalized = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function getUserByToken(store, token) {
  if (!token) {
    return null;
  }

  for (const user of Object.values(store.users)) {
    const session = user.sessions?.[token];
    if (!session) {
      continue;
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      delete user.sessions[token];
      continue;
    }
    return user;
  }

  return null;
}

export function getUserById(store, userId) {
  return store.users[normalizeEmail(userId)] || null;
}

export function createOrLoginUser(store, email) {
  const userId = normalizeEmail(email);
  let user = store.users[userId];

  if (!user) {
    user = {
      userId,
      email: userId,
      displayName: userId.split("@")[0] || "user",
      balanceWei: INITIAL_USER_BALANCE_WEI,
      createdAt: new Date().toISOString(),
      sessions: {},
    };
    store.users[userId] = user;
  }

  const sessionToken = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  user.sessions[sessionToken] = {
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  return { user, sessionToken, expiresAt };
}

export function anchorForUser(store, userId, stateHash, feeWei = ANCHOR_FEE_WEI) {
  const user = getUserById(store, userId);
  if (!user) {
    throw new Error("User not found.");
  }

  const balance = BigInt(user.balanceWei || "0");
  const fee = BigInt(feeWei || ANCHOR_FEE_WEI);

  if (fee <= 0n) {
    throw new Error("Invalid anchor fee.");
  }

  if (balance < fee) {
    throw new Error("Insufficient NINK balance for anchor fee.");
  }

  user.balanceWei = (balance - fee).toString();

  const record = {
    id: randomUUID(),
    userId: user.userId,
    stateHash,
    feeWei: fee.toString(),
    anchoredAt: new Date().toISOString(),
    txHash: null,
    blockNumber: null,
    source: "pending",
  };

  store.anchors.push(record);
  return { user, record };
}

export function finalizeAnchorRecord(record, chainResult) {
  record.txHash = chainResult.txHash;
  record.blockNumber = chainResult.blockNumber ?? null;
  record.source = chainResult.source || "nink-cloud-relayer";
}
