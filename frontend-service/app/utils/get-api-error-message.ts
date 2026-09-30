export function getApiErrorMessage(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const errorRecord = error as Record<string, unknown>;

  if ("data" in errorRecord) {
    const message = getApiErrorMessage(errorRecord.data);
    if (message) return message;
  }
  const response = errorRecord.response;
  if (typeof response === "object" && response !== null && "_data" in response) {
    const message = getApiErrorMessage(response._data);
    if (message) return message;
  }
  for (const key of ["error", "message", "statusMessage"]) {
    const value = errorRecord[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}
