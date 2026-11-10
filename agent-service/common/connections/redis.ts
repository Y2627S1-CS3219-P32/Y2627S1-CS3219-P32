import { within } from '../deadline.js';
import { createClient, type RedisClientOptions } from 'redis';
import type { StreamEvent } from '../../contracts/events.js';
import { parseBounded, streamSchema } from '../../contracts/events.js';
import { logger } from '../shared/logger.js';

export function createStreams(url: string, onError: (error: unknown) => void) {
  if (!['redis:', 'rediss:'].includes(new URL(url).protocol)) throw new Error('Invalid Redis URL');
  const options = {
    url,
    socket: { connectTimeout: 1000, reconnectStrategy: false },
    commandsQueueMaxLength: 100,
  } satisfies RedisClientOptions;
  const writer = createClient(options);
  writer.on('error', onError);
  const newClient = () => createClient(options);
  const readers = new Set<ReturnType<typeof newClient>>();
  const key = (conversation: string) => {
    if (!conversation || conversation.length > 200 || /[{}\s]/.test(conversation))
      throw new Error('Invalid conversation ID');
    return `agent:conversation:{${conversation}}:events`;
  };
  let connecting: Promise<unknown> | undefined;
  async function connectWriter() {
    if (writer.isReady) return;
    connecting ??= writer.connect().finally(() => {
      connecting = undefined;
    });
    await connecting;
  }
  return {
    async ping() {
      await connectWriter();
      await writer.ping();
    },
    async cursor(conversation: string) {
      await connectWriter();
      const entries = await writer.xRevRange(key(conversation), '+', '-', { COUNT: 1 });
      return entries?.[0]?.id ?? '0-0';
    },
    async publish(event: StreamEvent, signal: AbortSignal): Promise<boolean> {
      const parsed = parseBounded(streamSchema, event);
      const stream = key(event.conversation_id);
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
      for (let attempt = 0; attempt < 3 && !deadline.aborted; attempt++) {
        try {
          await within(deadline, async () => {
            await connectWriter();
            await writer.xAdd(
              stream,
              '*',
              { payload: JSON.stringify(parsed) },
              { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: 1000 } },
            );
          });
          return true;
        } catch (error) {
          if (writer.isOpen) writer.destroy();
          onError(error);
        }
      }
      return false;
    },
    async *read(
      conversation: string,
      cursor: string,
      signal: AbortSignal,
    ): AsyncIterable<{ cursor: string; event: unknown } | { resync: true }> {
      const stream = key(conversation);
      if (!/^\d+-\d+$/.test(cursor)) {
        yield { resync: true };
        return;
      }
      if (readers.size >= 50) throw new Error('Redis reader limit reached');
      const reader = createClient(options);
      reader.on('error', onError);
      readers.add(reader);
      const cancel = () => {
        if (reader.isOpen) reader.destroy();
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        signal.throwIfAborted();
        await reader.connect();
        while (!signal.aborted) {
          const first = (await reader.xRange(stream, '-', '+', { COUNT: 1 })) ?? [];
          const earliest = first[0];
          if (cursor !== '0-0' && (!earliest || compareIds(cursor, earliest.id) < 0)) {
            yield { resync: true };
            return;
          }
          const result = await reader.xRead(
            { key: stream, id: cursor },
            { BLOCK: 1000, COUNT: 100 },
          );
          for (const entry of result ?? [])
            for (const message of entry.messages) {
              const payload = message.message.payload;
              if (!payload) throw new Error('Missing stream payload');
              const event = parseBounded(streamSchema, JSON.parse(payload));
              if (event.conversation_id !== conversation)
                throw new Error('Mismatched stream conversation');
              cursor = message.id;
              yield { cursor, event };
            }
        }
      } catch (error) {
        if (!signal.aborted) {
          onError(error);
          yield { resync: true };
        }
      } finally {
        signal.removeEventListener('abort', cancel);
        readers.delete(reader);
        if (reader.isOpen) reader.destroy();
      }
    },
    async close() {
      for (const reader of readers) if (reader.isOpen) reader.destroy();
      if (writer.isOpen) writer.destroy();
    },
  };
}
function compareIds(a: string, b: string): number {
  const left = a.split('-').map(BigInt),
    right = b.split('-').map(BigInt);
  return left[0]! < right[0]!
    ? -1
    : left[0]! > right[0]!
      ? 1
      : left[1]! < right[1]!
        ? -1
        : left[1]! > right[1]!
          ? 1
          : 0;
}

let connection: ReturnType<typeof createStreams> | undefined;
export function streamConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('Missing REDIS_URL');
  // Claude Code (Opus 5.5), 2026-11-10: through the shared logger. Author review: Pending.
  return (connection ??= createStreams(url, (error) =>
    logger.error(
      { code: 'REDIS_CONNECTION_ERROR', err: error },
      error instanceof Error ? error.message : 'Unknown Redis error',
    ),
  ));
}
export async function closeStreamConnection() {
  await connection?.close();
  connection = undefined;
}
