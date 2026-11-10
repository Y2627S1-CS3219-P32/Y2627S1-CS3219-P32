import type { Request, Response } from 'express';
import { z } from 'zod';
import { authenticateUser } from '@campus/agent-contracts/http';
import { conversationId } from '@campus/agent-contracts/ids';
import { streamSchema } from '@campus/agent-contracts/events';
import { streamConnection } from '@campus/agent-contracts/connections/redis';
import * as service from '../services.js';

export async function streamConversationEvents(request: Request, response: Response) {
  const conversation = conversationId.parse(request.params.id);
  await service.getConversation(authenticateUser(request), conversation);
  const streams = streamConnection(),
    captured = await streams.cursor(conversation);
  const raw = request.headers['last-event-id'] ?? request.query.cursor;
  const valid = typeof raw === 'string' && /^\d+-\d+$/.test(raw) && raw.length <= 50;
  const invalid = raw != null && (!valid || cursorAfter(raw, captured));
  const cursor = valid && !invalid ? raw : captured;
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  response.flushHeaders();
  const controller = new AbortController();
  response.once('close', () => controller.abort());
  function send(text: string) {
    if (response.writableLength > 65536) {
      controller.abort();
      response.end();
      return;
    }
    response.write(text);
  }
  const timer = setInterval(() => send(': heartbeat\n\n'), 15000);
  const expiry = setTimeout(
    () => {
      controller.abort();
      response.end();
    },
    Math.min(900000, Math.max(0, tokenExpiry(request) - Date.now())),
  );
  try {
    send(': connected\n\n');
    if (invalid) send('event: resync_required\ndata: {"reason":"Invalid replay cursor"}\n\n');
    let start = cursor;
    while (!controller.signal.aborted) {
      for await (const frame of streams.read(conversation, start, controller.signal)) {
        if ('resync' in frame) {
          send('event: resync_required\ndata: {"reason":"Reload saved history"}\n\n');
          start = await streams.cursor(conversation);
          break;
        }
        const event = streamSchema.parse(frame.event);
        start = frame.cursor;
        send(`id: ${frame.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    }
  } finally {
    clearInterval(timer);
    clearTimeout(expiry);
    controller.abort();
    response.end();
  }
}

function cursorAfter(left: string, right: string) {
  const [leftTime = 0n, leftSeq = 0n] = left.split('-').map(BigInt);
  const [rightTime = 0n, rightSeq = 0n] = right.split('-').map(BigInt);
  return leftTime > rightTime || (leftTime === rightTime && leftSeq > rightSeq);
}
function tokenExpiry(request: Request) {
  const payload = request.headers.authorization?.split('.')[1];
  if (!payload) return Date.now();
  const value = z
    .object({ exp: z.number() })
    .parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
  return value.exp * 1000;
}
