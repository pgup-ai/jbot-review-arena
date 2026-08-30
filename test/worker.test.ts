import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  dockerRunArgs,
  failedResult,
  materializeTarget,
  pullAndVerifyImage,
  readJbotAuthEnvironment,
} from '../src/worker.ts';
import { fixtureManifest } from './helpers.ts';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

describe('arena worker boundary', () => {
  it('builds a pinned container invocation with J-Bot auth isolated from runner tokens', () => {
    const manifest = fixtureManifest(['cline/cline-free/model']);
    const auth = readJbotAuthEnvironment({
      JBOT_AUTH_JSON: JSON.stringify({
        CLINE_AUTH_JSON: 'secret-value',
        FUTURE_PROVIDER_TOKEN: 'future-secret',
        _INTERNAL_TOKEN: 'internal-secret',
        EMPTY: '',
        github_token: 'automatic-token',
        GITHUB_TOKEN: 'github-token',
        GH_TOKEN: 'gh-token',
      }),
    });
    assert.deepEqual(auth, {
      CLINE_AUTH_JSON: 'secret-value',
      FUTURE_PROVIDER_TOKEN: 'future-secret',
      _INTERNAL_TOKEN: 'internal-secret',
    });
    const args = dockerRunArgs(manifest, '/target', '/control/comparison.json', '/out');
    assert.ok(args.includes('type=bind,src=/target,dst=/workspace,readonly'));
    assert.ok(
      args.includes(
        'type=bind,src=/control/comparison.json,dst=/run/jbot-comparison/comparison.json,readonly',
      ),
    );
    assert.ok(args.includes('JBOT_AUTH_JSON'));
    assert.doesNotMatch(
      args.join(' '),
      /CLINE_AUTH_JSON|FUTURE_PROVIDER_TOKEN|github.token|GITHUB_TOKEN|GH_TOKEN|secret-value/,
    );
    assert.ok(args.includes(`ghcr.io/pgup-ai/jbot-review@${manifest.jbot.imageDigest}`));
    assert.throws(() => readJbotAuthEnvironment({ JBOT_AUTH_JSON: '[]' }), /must be a JSON object/);
  });

  it('materializes exact fork head/base commits and their frozen diff', () => {
    const root = mkdtempSync(join(tmpdir(), 'jbot-arena-checkout-'));
    const base = join(root, 'base');
    const head = join(root, 'head');
    const workspace = join(root, 'workspace');
    try {
      git(root, ['init', '-q', '-b', 'main', base]);
      git(base, ['config', 'user.email', 'test@example.com']);
      git(base, ['config', 'user.name', 'test']);
      git(base, ['config', 'uploadpack.allowFilter', 'true']);
      writeFileSync(join(base, 'code.ts'), 'export const value = 1;\n');
      git(base, ['add', '.']);
      git(base, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'base']);
      const mergeBase = git(base, ['rev-parse', 'HEAD']);
      execFileSync('git', ['clone', '-q', base, head]);
      git(head, ['config', 'user.email', 'test@example.com']);
      git(head, ['config', 'user.name', 'test']);
      git(head, ['config', 'uploadpack.allowFilter', 'true']);
      writeFileSync(join(base, 'code.ts'), 'export const value = 2;\n');
      git(base, ['add', '.']);
      git(base, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'base tip']);
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
      assert.equal(git(workspace, ['merge-base', manifest.target.base.sha, 'HEAD']), mergeBase);
      assert.equal(git(workspace, ['status', '--porcelain=v1', '--untracked-files=all']), '');
      assert.equal(readFileSync(join(workspace, 'code.ts'), 'utf8'), 'export const value = 2;\n');
      git(workspace, ['remote', 'set-url', 'head', join(root, 'missing')]);
      git(workspace, ['remote', 'set-url', 'base', join(root, 'missing')]);
      assert.match(
        git(workspace, ['diff', `${manifest.target.base.sha}...${manifest.target.head.sha}`]),
        /-export const value = 1;\n\+export const value = 2;/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('verifies the pinned digest with a Docker-safe multi-digest format', () => {
    const manifest = fixtureManifest();
    const calls: string[][] = [];
    pullAndVerifyImage(manifest, (_command, args) => {
      calls.push(args);
      return args[0] === 'pull'
        ? ''
        : `ghcr.io/example/other@sha256:${'0'.repeat(64)}\nghcr.io/pgup-ai/jbot-review@${manifest.jbot.imageDigest}`;
    });
    assert.equal(calls[1]?.at(-1), '{{range .RepoDigests}}{{println .}}{{end}}');
  });

  it('emits a scrubbed failure envelope without inventing usage or resolved backend data', () => {
    const manifest = fixtureManifest();
    const result = failedResult(
      manifest,
      manifest.models[0]!,
      'runner-exit',
      'token=secret-value',
      12,
      ['secret-value'],
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.failure?.class, 'runner-exit');
    assert.doesNotMatch(result.failure!.message, /secret-value/);
    assert.equal(result.usage.sessions, 0);
    assert.equal(result.provenance.backend, null);
  });
});
