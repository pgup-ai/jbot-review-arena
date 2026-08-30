import assert from 'node:assert/strict';
import { it } from 'node:test';

import { prepareComparison } from '../src/prepare.ts';
import { IMAGE_DIGEST, JBOT_SHA } from './helpers.ts';

it('freezes fork metadata, image identity, and requested model order', async () => {
  const manifest = await prepareComparison({
    event: {
      action: 'created',
      issue: { number: 5, pull_request: {} },
      comment: {
        id: 99,
        author_association: 'OWNER',
        body: '/compare https://github.com/acme/widget/pull/7 --models=nvidia/moonshotai/kimi-k3,openrouter/openai/gpt-oss:free',
      },
    },
    arenaRepository: 'pgup-ai/jbot-review-arena',
    workflowRunId: 123,
    runAttempt: 2,
    jbotCommitSha: JBOT_SHA,
    imageRepository: 'ghcr.io/pgup-ai/jbot-review',
    imageDigest: IMAGE_DIGEST,
    resolvePull: async () => ({
      html_url: 'https://github.com/acme/widget/pull/7',
      number: 7,
      title: 'Title',
      body: null,
      base: {
        ref: 'main',
        sha: '1'.repeat(40),
        repo: {
          full_name: 'acme/widget',
          clone_url: 'https://github.com/acme/widget.git',
          private: false,
        },
      },
      head: {
        ref: 'feature',
        sha: '2'.repeat(40),
        repo: {
          full_name: 'contributor/widget',
          clone_url: 'https://github.com/contributor/widget.git',
          private: false,
        },
      },
    }),
  });

  assert.equal(manifest.comparisonId, 'pgup-ai/jbot-review-arena:pr-5:comment-99');
  assert.equal(manifest.target.head.repository, 'contributor/widget');
  assert.equal(manifest.target.body, '');
  assert.equal(manifest.jbot.imageDigest, IMAGE_DIGEST);
  assert.deepEqual(
    manifest.models.map(({ index, model, provider }) => ({ index, model, provider })),
    [
      {
        index: 0,
        model: 'nvidia/moonshotai/kimi-k3',
        provider: 'nvidia',
      },
      {
        index: 1,
        model: 'openrouter/openai/gpt-oss:free',
        provider: 'openrouter',
      },
    ],
  );
});
