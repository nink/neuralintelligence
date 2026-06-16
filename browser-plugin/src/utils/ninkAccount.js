export function normalizeAccountEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidStubEmail(email) {
  const normalized = normalizeAccountEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function buildStubSession(email) {
  const userId = normalizeAccountEmail(email);

  return {
    userId,
    email: userId,
    displayName: userId.split("@")[0] || "user",
    loggedInAt: new Date().toISOString(),
    stub: true,
  };
}

export function formatAccountLabel(session) {
  if (!session?.email) {
    return "Not signed in";
  }
  return `Signed in as ${session.email}`;
}
