export function report(error: unknown) {
  console.error({
    code: 'MANDATE_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}
