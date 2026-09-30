const FORWARDED_STATUSES = new Set([400, 401, 403, 404, 409]);

export function toUserServiceError(error: unknown) {
  if (typeof error === "object" && error !== null && "statusCode" in error &&
    typeof error.statusCode === "number" && FORWARDED_STATUSES.has(error.statusCode)) {
    const data = "data" in error ? error.data : undefined;
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
      ? data.error
      : "The user request was rejected.";
    return createError({
      statusCode: error.statusCode,
      statusMessage: message,
      data: { error: message },
    });
  }

  return createError({
    statusCode: 502,
    statusMessage: "The user service is temporarily unavailable. Please try again.",
    data: { error: "The user service is temporarily unavailable. Please try again." },
  });
}
