export const ErrorCodes = Object.freeze({
  LOGIN_FAILED: "LOGIN_FAILED",
  INVALID_CONFIG: "INVALID_CONFIG",
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  NETWORK_ERROR: "NETWORK_ERROR",
  ALREADY_INITIALIZED: "ALREADY_INITIALIZED",
  NOT_INITIALIZED: "NOT_INITIALIZED",
  NOT_IN_PORTAL: "NOT_IN_PORTAL",
  OPERATION_IN_PROGRESS: "OPERATION_IN_PROGRESS",
  OPERATION_TIMEOUT: "OPERATION_TIMEOUT",
});

export function makeError(code, message) {
  return { code: code, message: message };
}

export function getErrorMessage(error) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

export function normalizeError(error) {
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  ) {
    return error;
  }
  return makeError(ErrorCodes.INVALID_PAYLOAD, getErrorMessage(error));
}
