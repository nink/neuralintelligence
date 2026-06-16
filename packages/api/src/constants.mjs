import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = Number(process.env.NINK_API_PORT || 8787);
export const HOST = process.env.NINK_API_HOST || "127.0.0.1";

export const TOKEN_DECIMALS = 18;
export const TOKEN_SCALE = 10n ** 18n;
export const INITIAL_USER_BALANCE_WEI = (100n * TOKEN_SCALE).toString();
export const ANCHOR_FEE_WEI = (10n ** 16n).toString();

export const STORE_PATH =
  process.env.NINK_API_STORE ||
  path.join(__dirname, "..", "data", "dev-store.json");

export const DEPLOYMENT_PATH =
  process.env.NINK_DEPLOYMENT_JSON ||
  path.join(__dirname, "..", "..", "contracts", "deployments", "31337.json");

export const RPC_URL = process.env.NINK_RPC_URL || "http://127.0.0.1:8545";
export const RELAYER_PRIVATE_KEY =
  process.env.NINK_RELAYER_PRIVATE_KEY ||
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
