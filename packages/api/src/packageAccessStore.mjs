import { createHash, randomBytes } from "node:crypto";
import { requireSupabase } from "./supabaseClient.mjs";
import { AccessRequestError, PackageAccessError } from "./packageErrors.mjs";
import {
  sendAccessApprovedNoticeEmail,
  sendAccessDeniedNoticeEmail,
  sendAccessRequestEmail,
} from "./resend.mjs";

function tokenPepper() {
  return (
    process.env.ACCESS_REQUEST_TOKEN_PEPPER ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "dev-access-request-pepper"
  );
}

export function generateAccessActionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashAccessActionToken(token) {
  return createHash("sha256")
    .update(`${String(token).trim()}:${tokenPepper()}`)
    .digest("hex");
}

function publicBaseUrl() {
  return process.env.NINK_PUBLIC_BASE_URL || "https://ni.nink.com";
}

async function loadPackageRow(packageId) {
  const supabase = requireSupabase();
  const row = await supabase
    .from("evidence_packages")
    .select("id, owner_id, title, encrypted_payload, payload_hash, encryption_version, state_hash")
    .eq("id", packageId)
    .maybeSingle();

  if (row.error) {
    throw new Error(row.error.message);
  }

  return row.data;
}

async function loadUserEmail(userId) {
  const supabase = requireSupabase();
  const row = await supabase.from("app_users").select("id, email").eq("id", userId).maybeSingle();

  if (row.error) {
    throw new Error(row.error.message);
  }

  return row.data;
}

async function hasActiveGrant(userId, packageId) {
  const supabase = requireSupabase();
  const row = await supabase
    .from("package_access_grants")
    .select("id")
    .eq("package_id", packageId)
    .eq("granted_to_user_id", userId)
    .maybeSingle();

  if (row.error) {
    throw new Error(row.error.message);
  }

  return Boolean(row.data);
}

export async function loadAccessiblePackage(userId, packageId) {
  const pkg = await loadPackageRow(packageId);

  if (!pkg) {
    throw new PackageAccessError("Package not found.");
  }

  if (pkg.owner_id === userId) {
    return { ...pkg, accessRole: "owner" };
  }

  if (await hasActiveGrant(userId, packageId)) {
    return { ...pkg, accessRole: "granted" };
  }

  throw new PackageAccessError(
    "You do not have access to this package. Ask the owner for access."
  );
}

export async function getPackageAccessStatus(user, packageId) {
  if (!packageId) {
    throw new Error("packageId is required.");
  }

  const pkg = await loadPackageRow(packageId);

  if (!pkg) {
    throw new PackageAccessError("Package not found.");
  }

  if (pkg.owner_id === user.id) {
    return {
      packageId: pkg.id,
      title: pkg.title,
      accessStatus: "owner",
      canUnlock: true,
      requestPending: false,
    };
  }

  if (await hasActiveGrant(user.id, packageId)) {
    return {
      packageId: pkg.id,
      title: pkg.title,
      accessStatus: "granted",
      canUnlock: true,
      requestPending: false,
    };
  }

  const supabase = requireSupabase();
  const latest = await supabase
    .from("package_access_requests")
    .select("id, status, created_at")
    .eq("package_id", packageId)
    .eq("requester_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest.error) {
    throw new Error(latest.error.message);
  }

  if (latest.data?.status === "pending") {
    return {
      packageId: pkg.id,
      title: pkg.title,
      accessStatus: "pending",
      canUnlock: false,
      requestPending: true,
    };
  }

  if (latest.data?.status === "denied") {
    return {
      packageId: pkg.id,
      title: pkg.title,
      accessStatus: "denied",
      canUnlock: false,
      requestPending: false,
    };
  }

  return {
    packageId: pkg.id,
    title: pkg.title,
    accessStatus: "none",
    canUnlock: false,
    requestPending: false,
  };
}


export async function requestPackageAccess(user, packageId, message = "") {
  if (!packageId) {
    throw new Error("packageId is required.");
  }

  const pkg = await loadPackageRow(packageId);

  if (!pkg) {
    throw new PackageAccessError("Package not found.");
  }

  if (pkg.owner_id === user.id) {
    throw new AccessRequestError("You already own this package.");
  }

  if (await hasActiveGrant(user.id, packageId)) {
    throw new AccessRequestError("You already have access to this package.");
  }

  const supabase = requireSupabase();
  const pending = await supabase
    .from("package_access_requests")
    .select("id")
    .eq("package_id", packageId)
    .eq("requester_id", user.id)
    .eq("status", "pending")
    .maybeSingle();

  if (pending.error) {
    throw new Error(pending.error.message);
  }

  if (pending.data) {
    throw new AccessRequestError("Access request already pending. The owner was emailed.");
  }

  const owner = await loadUserEmail(pkg.owner_id);
  if (!owner?.email) {
    throw new Error("Package owner email not found.");
  }

  const approveToken = generateAccessActionToken();
  const denyToken = generateAccessActionToken();
  const safeMessage = String(message || "").trim().slice(0, 500);

  const insert = await supabase
    .from("package_access_requests")
    .insert({
      package_id: packageId,
      requester_id: user.id,
      owner_id: pkg.owner_id,
      status: "pending",
      requester_message: safeMessage || null,
      approve_token_hash: hashAccessActionToken(approveToken),
      deny_token_hash: hashAccessActionToken(denyToken),
    })
    .select("id, created_at")
    .single();

  if (insert.error) {
    throw new Error(insert.error.message);
  }

  const approveUrl = `${publicBaseUrl()}/access-request/respond?token=${encodeURIComponent(approveToken)}`;
  const denyUrl = `${publicBaseUrl()}/access-request/respond?token=${encodeURIComponent(denyToken)}`;

  await sendAccessRequestEmail({
    ownerEmail: owner.email,
    requesterEmail: user.email,
    packageTitle: pkg.title,
    packageId: pkg.id,
    message: safeMessage,
    approveUrl,
    denyUrl,
  });

  return {
    requestId: insert.data.id,
    accessStatus: "pending",
    canUnlock: false,
    requestPending: true,
    ownerEmail: owner.email,
    createdAt: insert.data.created_at,
  };
}

export async function respondToPackageAccessRequest(token) {
  if (!token || String(token).trim().length < 20) {
    throw new AccessRequestError("Invalid or missing access token.");
  }

  const tokenHash = hashAccessActionToken(token);
  const supabase = requireSupabase();

  let action = null;
  let requestRow = null;

  const byApprove = await supabase
    .from("package_access_requests")
    .select(
      "id, package_id, requester_id, owner_id, status, requester_message, created_at"
    )
    .eq("approve_token_hash", tokenHash)
    .maybeSingle();

  if (byApprove.error) {
    throw new Error(byApprove.error.message);
  }

  if (byApprove.data) {
    action = "approved";
    requestRow = byApprove.data;
  } else {
    const byDeny = await supabase
      .from("package_access_requests")
      .select(
        "id, package_id, requester_id, owner_id, status, requester_message, created_at"
      )
      .eq("deny_token_hash", tokenHash)
      .maybeSingle();

    if (byDeny.error) {
      throw new Error(byDeny.error.message);
    }

    if (byDeny.data) {
      action = "denied";
      requestRow = byDeny.data;
    }
  }

  if (!requestRow || !action) {
    throw new AccessRequestError("This access link is invalid or has expired.");
  }

  const pkg = await loadPackageRow(requestRow.package_id);
  const requester = await loadUserEmail(requestRow.requester_id);
  const owner = await loadUserEmail(requestRow.owner_id);

  if (requestRow.status !== "pending") {
    return {
      action: requestRow.status,
      alreadyResolved: true,
      packageTitle: pkg?.title || "Evidence package",
      requesterEmail: requester?.email || "requester",
      ownerEmail: owner?.email || "owner",
    };
  }

  const now = new Date().toISOString();

  if (action === "approved") {
    const update = await supabase
      .from("package_access_requests")
      .update({ status: "approved", resolved_at: now, updated_at: now })
      .eq("id", requestRow.id)
      .eq("status", "pending");

    if (update.error) {
      throw new Error(update.error.message);
    }

    const grant = await supabase.from("package_access_grants").upsert(
      {
        package_id: requestRow.package_id,
        granted_to_user_id: requestRow.requester_id,
        granted_by_user_id: requestRow.owner_id,
        request_id: requestRow.id,
      },
      { onConflict: "package_id,granted_to_user_id" }
    );

    if (grant.error) {
      throw new Error(grant.error.message);
    }

    if (requester?.email) {
      await sendAccessApprovedNoticeEmail({
        requesterEmail: requester.email,
        ownerEmail: owner?.email || "the owner",
        packageTitle: pkg?.title || "Evidence package",
        packageId: requestRow.package_id,
      }).catch(() => {});
    }

    return {
      action: "approved",
      alreadyResolved: false,
      packageTitle: pkg?.title || "Evidence package",
      requesterEmail: requester?.email || "requester",
      ownerEmail: owner?.email || "owner",
    };
  }

  const update = await supabase
    .from("package_access_requests")
    .update({ status: "denied", resolved_at: now, updated_at: now })
    .eq("id", requestRow.id)
    .eq("status", "pending");

  if (update.error) {
    throw new Error(update.error.message);
  }

  if (requester?.email) {
    await sendAccessDeniedNoticeEmail({
      requesterEmail: requester.email,
      ownerEmail: owner?.email || "the owner",
      packageTitle: pkg?.title || "Evidence package",
    }).catch(() => {});
  }

  return {
    action: "denied",
    alreadyResolved: false,
    packageTitle: pkg?.title || "Evidence package",
    requesterEmail: requester?.email || "requester",
    ownerEmail: owner?.email || "owner",
  };
}
