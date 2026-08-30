import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { dockerRunArgs, failedResult, materializeTarget } from '../src/worker.ts';
import { fixtureManifest } from './helpers.ts';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

describe('arena worker boundary', () => {
  it('builds a pinned container invocation with a read-only target and one credential alias', () => {
    const manifest = fixtureManifest();
    const args = dockerRunArgs(
      manifest,
      manifest.models[0]!,
      '/target',
      '/control/comparison.json',
      '/out',
    );
    assert.ok(args.includes('type=bind,src=/target,dst=/workspace,readonly'));
    assert.ok(
      args.includes(
        'type=bind,src=/control/comparison.json,dst=/run/jbot-comparison/comparison.json,readonly',
      ),
    );
    assert.ok(args.includes('OPENROUTER_API_KEY'));
    assert.doesNotMatch(args.join(' '), /github.token|GITHUB_TOKEN|secret-value/);
    assert.ok(args.includes(`ghcr.io/pgup-ai/jbot-review@${manifest.jbot.imageDigest}`));
  });

  it('materializes exact fork head/base commits and leaves a clean detached checkout', () => {
    const root = mkdtempSync(join(tmpdir(), 'jbot-arena-checkout-'));
    const base = join(root, 'base');
    const head = join(root, 'head');
    const workspace = join(root, 'workspace');
    try {
      git(root, ['init', '-q', '-b', 'main', base]);
      git(base, ['config', 'user.email', 'test@example.com']);
      git(base, ['config', 'user.name', 'test']);
      writeFileSync(join(base, 'code.ts'), 'export const value = 1;\n');
      git(base, ['add', '.']);
      git(base, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'base']);
      execFileSync('git', ['clone', '-q', base, head]);
      git(head, ['config', 'user.email', 'test@example.com']);
      git(head, ['config', 'user.name', 'test']);
      writeFileSync(join(head, 'code.ts'), 'export const value = 2;\n');
      git(head, ['add', '.']);
      git(head, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'head']);
      const manifest = fixtureManifest();
      manifest.target.base.cloneUrl = base;
      manifest.target.base.sha = git(base, ['rev-parse', 'HEAD']);
      manifest.target.head.cloneUrl = head;
      manifest.target.head.sha = git(head, ['rev-parse', 'HEAD']);
      materializeTarget(manifest, workspace);
      assert.equal(git(workspace, ['rev-parse', 'HEAD']), manifest.target.head.sha);
      assert.equal(
        git(workspace, ['merge-base', manifest.target.base.sha, 'HEAD']),
        manifest.target.base.sha,
      );
      assert.equal(git(workspace, ['status', '--porcelain=v1', '--untracked-files=all']), '');
      assert.equal(readFileSync(join(workspace, 'code.ts'), 'utf8'), 'export const value = 2;\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits a scrubbed failure envelope without inventing usage or resolved backend data', () => {
    const manifest = fixtureManifest();
    const result = failedResult(
      manifest,
      manifest.models[0]!,
      'credential',
      'token=secret-value',
      12,
      ['secret-value'],
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.failure?.class, 'credential');
    assert.doesNotMatch(result.failure!.message, /secret-value/);
    assert.equal(result.usage.sessions, 0);
    assert.equal(result.provenance.backend, null);
  });
});
