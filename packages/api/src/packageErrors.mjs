export class PackageAccessError extends Error {
  constructor(message = "Access denied.") {
    super(message);
    this.name = "PackageAccessError";
  }
}

export class InsufficientBalanceError extends Error {
  constructor(message = "Insufficient credits.") {
    super(message);
    this.name = "InsufficientBalanceError";
  }
}

export class AccessRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "AccessRequestError";
  }
}
