import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sandboxes: string[] = [];
const script = resolve('scripts/check-client-secrets.mjs');

afterEach(() => {
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true });
});

function runCheck(bundle: string, dotenv = '') {
  const tempRoot = join(tmpdir(), 'opencode');
  mkdirSync(tempRoot, { recursive: true });
  const sandbox = mkdtempSync(join(tempRoot, 'kyon-secrets-test-'));
  sandboxes.push(sandbox);
  mkdirSync(join(sandbox, 'dist'));
  writeFileSync(join(sandbox, 'dist', 'client.js'), bundle);
  if (dotenv) writeFileSync(join(sandbox, '.env'), dotenv);
  return spawnSync(process.execPath, [script], {
    cwd: sandbox,
    env: { ...process.env, MONGODB_URI: '', SESSION_SECRET: '' },
    encoding: 'utf8',
  });
}

describe('build credential check', () => {
  it('passes a client bundle with no private configuration', () => {
    expect(runCheck('console.log("Kyon+")').status).toBe(0);
  });

  it('blocks a leaked session secret without printing its value', () => {
    const secret = 'synthetic-secret-for-build-regression';
    const result = runCheck(`const leaked = "${secret}";`, `SESSION_SECRET="${secret}"`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SESSION_SECRET');
    expect(result.stderr.includes(secret)).toBe(false);
  });


  it('blocks a leaked MongoDB password even if the full URI is absent', () => {
    const password = 'syntheticDbPassword42';
    const result = runCheck(`const leaked = "${password}";`, `MONGODB_URI="mongodb+srv://test:${password}@example.invalid/"`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MongoDB password');
    expect(result.stderr.includes(password)).toBe(false);
  });

  it('does not load or print unrelated environment values', () => {
    const result = runCheck('const publicValue = "synthetic-public-value";', 'OTHER_CONFIG="synthetic-public-value"');
    expect(result.status).toBe(0);
  });
});
