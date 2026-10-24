import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, '..', '..');
const repoRoot = join(apiRoot, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

describe('Module 8A isolation and secret hygiene', () => {
  const aiSources = walk(here).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('fixtures.ts'));

  it('AI source files import only Node built-ins and sibling modules (no signing or wallet library)', () => {
    assert.ok(aiSources.length > 5);
    for (const file of aiSources) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] ?? '');
      for (const specifier of imports) {
        assert.ok(specifier.startsWith('.') || specifier.startsWith('node:'), `${relative(repoRoot, file)} imports ${specifier}`);
      }
    }
  });

  it('AI source files read no private key, mnemonic or signing capability', () => {
    for (const file of aiSources) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/privateKey|mnemonic|signTypedData|signMessage|sendTransaction|sendRawTransaction/i.test(text), relative(repoRoot, file));
    }
  });

  it('the AI variables are never referenced from the web app (so they cannot reach the browser)', () => {
    const webFiles = walk(join(repoRoot, 'apps', 'web')).filter((f) => /\.(ts|tsx|js|json|html)$/.test(f) || f.endsWith('.env.example'));
    assert.ok(webFiles.length > 50);
    for (const file of webFiles) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/AI_API_KEY|AI_PROVIDER|AI_MODEL|VITE_AI_/.test(text), `${relative(repoRoot, file)} references an AI secret variable`);
    }
  });

  it('every committed env example holds placeholders only', () => {
    const examples = walk(repoRoot).filter((f) => /(^|\/)\.env\.example$/.test(f));
    assert.ok(examples.length >= 3);
    for (const file of examples) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const match = /^\s*([A-Z0-9_]*_(KEY|SECRET|TOKEN|PASSWORD|MNEMONIC))\s*=\s*(.*)$/.exec(line);
        if (match) assert.equal((match[3] ?? '').trim(), '', `${relative(repoRoot, file)}: ${match[1]} must be empty`);
        assert.ok(!/\b(sk-[A-Za-z0-9_-]{8,}|0x[0-9a-fA-F]{64})\b/.test(line), `${relative(repoRoot, file)} contains a secret-like value`);
      }
    }
  });

  it('no real .env file is shipped', () => {
    const stray = walk(repoRoot).filter((f) => /(^|\/)\.env(\.[^/]*)?$/.test(f) && !f.endsWith('.env.example'));
    assert.deepEqual(stray.map((f) => relative(repoRoot, f)), []);
  });
});
