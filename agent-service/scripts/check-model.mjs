import { readFile } from 'node:fs/promises';
import { streamModelResponse } from '../orchestrator/dist/llm/model.js';
import { createToolRegistry } from '../orchestrator/dist/llm/tools/registry.js';
// Loads server-only settings without logging credentials or provider response bodies.
for (const line of (await readFile(new URL('../../.env', import.meta.url), 'utf8')).split('\n')) {
  const match = line.match(/^(SOCLAAS_(?:API_KEY|BASE_URL|MODEL))=(.*)$/);
  if (match && !process.env[match[1]])
    process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
}
for (const [label, text] of [
  ['text', 'Reply with the single word hello.'],
  ['tool', 'Use search_suppliers to search for coffee. Call the tool now.'],
]) {
  let final;
  for await (const event of streamModelResponse(
    [{ role: 'user', content: { kind: 'text', text } }],
    [...createToolRegistry().values()].map((value) => value.definition),
    AbortSignal.timeout(60000),
  )) {
    if (event.kind === 'complete') final = event.response;
  }
  if (
    !final ||
    (label === 'tool' && (final.kind !== 'calls' || final.calls[0]?.name !== 'search_suppliers'))
  )
    throw new Error(`${label} model check failed`);
  console.log(
    `${label}: ${final.kind === 'calls' ? final.calls.map((call) => call.name).join(', ') : 'streaming response completed'}`,
  );
}
