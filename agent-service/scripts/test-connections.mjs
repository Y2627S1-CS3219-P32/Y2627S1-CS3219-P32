import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const args = [
  'compose',
  '-p',
  `agent-connections-${process.pid}`,
  '-f',
  'agent-service/test/compose.yaml',
];
const run = (command, values, env = process.env) =>
  execFileSync(command, values, { cwd: root, env, stdio: 'inherit' });
const port = (service, number) =>
  execFileSync('docker', [...args, 'port', service, String(number)], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split(':')
    .at(-1);
try {
  run('docker', [...args, 'up', '-d', '--wait']);
  const env = {
    ...process.env,
    PUBSUB_PROJECT_ID: 'foc-local',
    PUBSUB_EMULATOR_HOST: `127.0.0.1:${port('pubsub', 8085)}`,
    REDIS_URL: `redis://127.0.0.1:${port('redis', 6379)}`,
    TEST_DATABASE_URL: `postgres://postgres:test-only@127.0.0.1:${port('postgres', 5432)}/postgres`,
  };
  run('npm', ['run', 'build'], env);
  run('node', ['agent-service/scripts/provision.mjs'], env);
  run('npm', ['run', 'build', '--prefix', 'order-service'], env);
  run(
    'node',
    [
      '--test',
      '--test-concurrency=1',
      'test/service-boundaries.test.mjs',
      'test/service-contracts.test.mjs',
      'agent-service/test/connections.test.mjs',
      'agent-service/test/broker-streams.integration.mjs',
      'agent-service/test/model.test.mjs',
      'agent-service/test/flow.integration.mjs',
    ],
    env,
  );
  for (const service of ['order-service', 'supplier-service'])
    run('npm', ['test', '--prefix', service], env);
} finally {
  run('docker', [...args, 'down', '-v', '--remove-orphans']);
}
