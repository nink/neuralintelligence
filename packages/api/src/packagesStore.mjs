import { requireSupabase } from "./supabaseClient.mjs";
import {
  decryptPayload,
  encryptPayload,
  hashPayload,
} from "./packageEncryption.mjs";
import {
  PACKAGE_REPORT_FEE_WEI,
  PACKAGE_VERIFY_FEE_WEI,
  PACKAGE_VIEW_FEE_WEI,
} from "./constants.mjs";
import { weiToCredits } from "./credits.mjs";
import { InsufficientBalanceError, PackageAccessError } from "./packageErrors.mjs";
import { loadAccessiblePackage } from "./packageAccessStore.mjs";

export { InsufficientBalanceError, PackageAccessError } from "./packageErrors.mjs";

async function debitCredits(userId, amountWei, entryType, metadata = {}) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc("debit_virtual_nink", {
    p_user_id: userId,
    p_amount_wei: String(amountWei),
    p_entry_type: entryType,
    p_metadata: metadata,
  });

  if (error) {
    if (/insufficient/i.test(error.message)) {
      throw new InsufficientBalanceError();
    }
    throw new Error(error.message);
  }

  return data;
}

async function refundCredits(userId, amountWei, entryType, metadata = {}) {
  const supabase = requireSupabase();
  const { error } = await supabase.rpc("credit_virtual_nink", {
    p_user_id: userId,
    p_amount_wei: String(amountWei),
    p_entry_type: entryType,
    p_metadata: metadata,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function createEvidencePackage(user, { title, payload, stateHash }) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Package payload is required.");
  }

  const safeTitle = String(title || "NINK session").trim() || "NINK session";
  const encrypted = encryptPayload(payload);
  const supabase = requireSupabase();

  const insert = await supabase
    .from("evidence_packages")
    .insert({
      owner_id: user.id,
      title: safeTitle,
      encrypted_payload: encrypted.encryptedPayload,
      payload_hash: encrypted.payloadHash,
      encryption_version: encrypted.encryptionVersion,
      state_hash: stateHash ? String(stateHash) : null,
    })
    .select("id, title, payload_hash, state_hash, created_at")
    .single();

  if (insert.error) {
    throw new Error(insert.error.message);
  }

  return {
    packageId: insert.data.id,
    title: insert.data.title,
    payloadHash: insert.data.payload_hash,
    stateHash: insert.data.state_hash,
    createdAt: insert.data.created_at,
  };
}

export async function viewEvidencePackage(user, packageId) {
  const pkg = await loadAccessiblePackage(user.id, packageId);
  const feeWei = PACKAGE_VIEW_FEE_WEI;
  const metadata = { package_id: packageId, action: "view", access_role: pkg.accessRole };

  let debited = false;
  try {
    const debit = await debitCredits(user.id, feeWei, "package_view", metadata);
    debited = true;

    const payload = decryptPayload(pkg.encrypted_payload);
    const computedHash = hashPayload(payload);

    if (computedHash !== pkg.payload_hash) {
      await refundCredits(user.id, feeWei, "package_view_refund", {
        package_id: packageId,
        reason: "hash_mismatch",
      });
      throw new Error("Package integrity check failed after decrypt.");
    }

    return {
      packageId: pkg.id,
      title: pkg.title,
      payload,
      payloadHash: pkg.payload_hash,
      stateHash: pkg.state_hash,
      balance: debit.balance,
      creditsCharged: weiToCredits(feeWei),
      creditsRemaining: Number(debit.credits),
      accessRole: pkg.accessRole,
    };
  } catch (error) {
    if (debited && !/integrity check failed/i.test(error.message)) {
      await refundCredits(user.id, feeWei, "package_view_refund", {
        package_id: packageId,
        reason: error.message,
      }).catch(() => {});
    }
    throw error;
  }
}

export async function verifyEvidencePackage(user, packageId) {
  const pkg = await loadAccessiblePackage(user.id, packageId);
  const feeWei = PACKAGE_VERIFY_FEE_WEI;
  const metadata = { package_id: packageId, action: "verify", access_role: pkg.accessRole };

  let debited = false;
  try {
    const debit = await debitCredits(user.id, feeWei, "package_verify", metadata);
    debited = true;

    const payload = decryptPayload(pkg.encrypted_payload);
    const computedHash = hashPayload(payload);
    const valid = computedHash === pkg.payload_hash;

    if (!valid) {
      await refundCredits(user.id, feeWei, "package_verify_refund", {
        package_id: packageId,
        reason: "hash_mismatch",
      });
    }

    return {
      valid,
      storedHash: pkg.payload_hash,
      computedHash,
      verifiedAt: new Date().toISOString(),
      balance: valid ? debit.balance : undefined,
      creditsCharged: valid ? weiToCredits(feeWei) : 0,
      accessRole: pkg.accessRole,
    };
  } catch (error) {
    if (debited) {
      await refundCredits(user.id, feeWei, "package_verify_refund", {
        package_id: packageId,
        reason: error.message,
      }).catch(() => {});
    }
    throw error;
  }
}

export async function downloadEvidenceReport(user, packageId) {
  const pkg = await loadAccessiblePackage(user.id, packageId);
  const feeWei = PACKAGE_REPORT_FEE_WEI;
  const metadata = { package_id: packageId, action: "report", access_role: pkg.accessRole };

  let debited = false;
  try {
    const debit = await debitCredits(user.id, feeWei, "package_report", metadata);
    debited = true;

    const payload = decryptPayload(pkg.encrypted_payload);
    const computedHash = hashPayload(payload);

    if (computedHash !== pkg.payload_hash) {
      await refundCredits(user.id, feeWei, "package_report_refund", {
        package_id: packageId,
        reason: "hash_mismatch",
      });
      throw new Error("Package integrity check failed.");
    }

    const report = {
      generatedAt: new Date().toISOString(),
      packageId: pkg.id,
      title: pkg.title,
      stateHash: pkg.state_hash,
      payloadHash: pkg.payload_hash,
      messageCount: payload?.messageCount ?? payload?.conversation?.length ?? null,
      sourcePlatform: payload?.sourcePlatform ?? null,
      signOffContext: payload?.signOffContext ?? null,
    };

    return {
      report,
      balance: debit.balance,
      creditsCharged: weiToCredits(feeWei),
      creditsRemaining: Number(debit.credits),
      accessRole: pkg.accessRole,
    };
  } catch (error) {
    if (debited && !/integrity check failed/i.test(error.message)) {
      await refundCredits(user.id, feeWei, "package_report_refund", {
        package_id: packageId,
        reason: error.message,
      }).catch(() => {});
    }
    throw error;
  }
}
