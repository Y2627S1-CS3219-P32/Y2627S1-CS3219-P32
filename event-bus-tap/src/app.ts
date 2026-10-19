/**
 * AI Assistance Disclosure: Claude Code (Opus 5.5), 2026-10-19.
 * Scope: Wires the tap together; used by the entry point and the integration tests.
 * Author review: Pending.
 */
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { type Broker, PubSubBroker } from "./broker.js";
import type { TapConfig } from "./config.js";
import { createTapServer } from "./server.js";
import { EventStore } from "./store.js";
import { Tap } from "./tap.js";

export interface RunningTap {
  tap: Tap;
  store: EventStore;
  url: string;
  stop: () => Promise<void>;
}

export async function startTap(
  config: TapConfig,
  options: { instanceId: string; broker?: Broker; log?: (line: string) => void },
): Promise<RunningTap> {
  const store = new EventStore(config.maxEvents);
  const broker = options.broker ?? new PubSubBroker(config);
  const tap = new Tap({ config, broker, store, instanceId: options.instanceId, ...(options.log ? { log: options.log } : {}) });
  const { server, closeClients } = createTapServer({ tap, store, config });
  server.listen(config.port, config.host);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  // Listen first, so the viewer can show "connecting" while topics are discovered.
  void tap.start();
  return {
    tap,
    store,
    url: `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${port}`,
    stop: async () => {
      closeClients();
      server.closeAllConnections();
      server.close();
      await tap.stop();
    },
  };
}
