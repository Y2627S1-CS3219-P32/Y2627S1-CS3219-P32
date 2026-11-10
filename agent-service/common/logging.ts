export function report(error: unknown) {
  console.error({
    code: 'AGENT_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}
