import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  inertFence,
  loadResults,
  reconcileComments,
  renderModelReportParts,
  renderSummary,
} from '../src/publish.ts';
import { completedResult, fixtureManifest } from './helpers.ts';

describe('safe publisher rendering', () => {
  it('uses a longer adaptive fence and preserves adversarial prose inertly', () => {
    const text = '@team #123 [link](https://evil.test) <img src=x> ``` nested ````';
    const rendered = inertFence(text);
    assert.match(rendered, /^`````\n/);
    assert.ok(rendered.includes(text));
    assert.match(rendered, /\n`````$/);
  });

  it('renders deterministic summary order and splits oversized reports within the byte budget', () => {
    const manifest = fixtureManifest([
      'openrouter/openai/gpt-oss:free',
      'nvidia/moonshotai/kimi-k3',
    ]);
    const first = completedResult(manifest, 0);
    const second = completedResult(manifest, 1);
    first.review!.summary = '@team ' + '😀'.repeat(40_000);
    first.review!.findings.push({
      path: 'src/a file.ts',
      line: 7,
      severity: 'P1',
      title: '#123 <script>',
      body: '[remote](https://evil.test) ' + 'x'.repeat(80_000),
    });
    const summary = renderSummary(manifest, [first, second], true);
    assert.ok(summary.indexOf(first.model) < summary.indexOf(second.model));
    assert.match(summary, /historical snapshot/);
    const parts = renderModelReportParts(manifest, first);
    assert.ok(parts.length > 2);
    parts.forEach((part, index) => {
      assert.ok(Buffer.byteLength(part) <= 60 * 1024);
      assert.match(part.split('\n')[0]!, new RegExp(`:part=${index + 1} -->$`));
    });
    const rendered = parts.join('\n');
    assert.match(rendered, /Open frozen target location/);
    assert.match(rendered, /\/src\/a%20file\.ts#L7/);
    assert.ok(rendered.includes('[remote](https://evil.test)'));
  });

  it('synthesizes missing and invalid artifacts in requested model order', () => {
    const root = mkdtempSync(join(tmpdir(), 'jbot-arena-results-'));
    const manifest = fixtureManifest(['openrouter/a', 'nvidia/b']);
    try {
      const first = manifest.models[0]!;
      mkdirSync(join(root, first.artifactName), { recursive: true });
      writeFileSync(join(root, first.artifactName, 'result.json'), '{bad');
      const results = loadResults(manifest, root);
      assert.deepEqual(
        results.map(({ model }) => model),
        ['openrouter/a', 'nvidia/b'],
      );
      assert.equal(results[0]!.failure?.class, 'invalid-output');
      assert.equal(results[1]!.failure?.class, 'missing-artifact');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

it('reconciles paginated bot markers without touching user comments', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  const marker = '<!-- jbot-compare:comment=99:summary -->';
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (method === 'GET') {
      return new Response(
        JSON.stringify([
          { id: 5, body: `${marker}\nold`, user: { login: 'github-actions[bot]', type: 'Bot' } },
          {
            id: 6,
            body: `${marker}\nduplicate`,
            user: { login: 'github-actions[bot]', type: 'Bot' },
          },
          { id: 7, body: `${marker}\nuser`, user: { login: 'human', type: 'User' } },
          {
            id: 8,
            body: '<!-- jbot-compare:comment=99:model=' + 'a'.repeat(64) + ':part=2 -->\nstale',
            user: { login: 'github-actions[bot]', type: 'Bot' },
          },
        ]),
        { status: 200 },
      );
    }
    return new Response(method === 'DELETE' ? null : '{}', {
      status: method === 'DELETE' ? 204 : 200,
    });
  };
  try {
    await reconcileComments({
      repository: 'pgup-ai/jbot-review-arena',
      issueNumber: 1,
      commandCommentId: 99,
      desiredBodies: [`${marker}\nnew`],
      token: 'token',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(
    calls.some(({ method, url }) => method === 'PATCH' && url.endsWith('/issues/comments/5')),
  );
  assert.ok(
    calls.some(({ method, url }) => method === 'DELETE' && url.endsWith('/issues/comments/6')),
  );
  assert.ok(
    calls.some(({ method, url }) => method === 'DELETE' && url.endsWith('/issues/comments/8')),
  );
  assert.ok(!calls.some(({ url }) => url.endsWith('/issues/comments/7')));
});
