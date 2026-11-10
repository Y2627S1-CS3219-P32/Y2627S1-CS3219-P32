import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.filter(entry =>
    !['node_modules', 'dist', 'test', 'scripts', 'docs', 'migrations'].includes(entry.name),
  ).map(entry => {
    const path = resolve(folder, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }))).flat();
}

test('services own their code, package dependencies, build configs, and container inputs', async () => {
  for (const [service, other, forbiddenPackage] of [
    ['mandate-service', 'agent-service', '@campus/agent-contracts'],
    ['agent-service', 'mandate-service', 'mandate-service'],
  ]) {
    for (const path of await files(resolve(root, service))) {
      const source = await readFile(path, 'utf8');
      if (path.endsWith('.ts')) {
        for (const imported of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) {
          const target = imported[1];
          assert(!target.startsWith(forbiddenPackage), `${relative(root, path)} imports ${target}`);
          if (target.startsWith('.')) {
            const destination = relative(resolve(root, other), resolve(dirname(path), target));
            assert(destination.startsWith('..'), `${relative(root, path)} imports ${target}`);
          }
        }
      }
      if (path.endsWith('package.json')) {
        const pkg = JSON.parse(source);
        for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies })) {
          assert.notEqual(name, forbiddenPackage, `${relative(root, path)} depends on ${name}`);
        }
      }
      if (/tsconfig.*\.json$|Dockerfile$/.test(path)) {
        assert(!source.includes(other), `${relative(root, path)} references ${other}`);
      }
    }
  }
});
