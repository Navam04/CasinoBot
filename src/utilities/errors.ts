export class AppError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  public constructor(entity: string) {
    super(`${entity} was not found.`, "NOT_FOUND");
  }
}

export class AuthorizationError extends AppError {
  public constructor(message = "You do not have permission to do that.") {
    super(message, "FORBIDDEN");
  }
}

export class ConflictError extends AppError {
  public constructor(message: string) {
    super(message, "CONFLICT");
  }
}

export class ValidationError extends AppError {
  public constructor(message: string) {
    super(message, "VALIDATION");
  }
}
export function publicErrorMessage(error: unknown): string {
  return error instanceof AppError ? error.message : "Something went wrong. Please try again.";
}
