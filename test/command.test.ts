import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertAuthorizedArenaComment, parseCompareCommand } from '../src/command.ts';

describe('/compare command', () => {
  it('accepts exact PR URLs and nested qualified models from the first line', () => {
    assert.deepEqual(
      parseCompareCommand(
        '/compare https://github.com/acme/widget/pull/42 --models=cline/cline-free/longcat-2.0,nvidia/moonshotai/kimi-k3\nignored',
      ),
      {
        target: {
          url: 'https://github.com/acme/widget/pull/42',
          owner: 'acme',
          repository: 'widget',
          prNumber: 42,
        },
        models: ['cline/cline-free/longcat-2.0', 'nvidia/moonshotai/kimi-k3'],
      },
    );
  });

  it('rejects unsafe targets, flags, model syntax, duplicates, and caps', () => {
    const invalid = [
      '/compare http://github.com/a/b/pull/1 --models=openrouter/a',
      '/compare https://evil.test/a/b/pull/1 --models=openrouter/a',
      '/compare https://github.com/a/b/pull/1?x=1 --models=openrouter/a',
      '/compare https://github.com/a/b/pull/1 --models=openrouter/a --extra=x',
      '/compare https://github.com/a/b/pull/1 --models=openrouter/a,$HOME',
      '/compare https://github.com/a/b/pull/1 --models=openrouter/a,openrouter/a',
      `/compare https://github.com/a/b/pull/1 --models=${Array(9)
        .fill('openrouter/a')
        .map((model, index) => `${model}${index}`)
        .join(',')}`,
    ];
    for (const command of invalid) assert.throws(() => parseCompareCommand(command));
    assert.equal(
      parseCompareCommand('/compare https://github.com/a/b/pull/1 --models=future-provider/model')
        .models[0],
      'future-provider/model',
    );
  });

  it('requires a newly created PR comment from a trusted association', () => {
    const event = {
      action: 'created',
      issue: { pull_request: {} },
      comment: { author_association: 'MEMBER' },
    };
    assert.doesNotThrow(() => assertAuthorizedArenaComment(event));
    assert.throws(() => assertAuthorizedArenaComment({ ...event, action: 'edited' }));
    assert.throws(() =>
      assertAuthorizedArenaComment({ ...event, comment: { author_association: 'CONTRIBUTOR' } }),
    );
    assert.throws(() => assertAuthorizedArenaComment({ ...event, issue: {} }));
  });
});
