import { createTransport, httpConfig } from '@campus/agent-contracts/connections/http';
export { ConnectionError } from '@campus/agent-contracts/connections/http';
let transport: ReturnType<typeof createTransport> | undefined;
export const requestInternalService: ReturnType<typeof createTransport> = input => {
  transport ??= createTransport(httpConfig());
  return transport(input);
};
