import {
  DEFAULT_REVIEW_CONFIG,
  arenaArtifactName,
  type ArenaResultV1,
  type ComparisonManifestV1,
} from '../src/contract.ts';

export const BASE_SHA = '1'.repeat(40);
export const HEAD_SHA = '2'.repeat(40);
export const JBOT_SHA = '3'.repeat(40);
export const IMAGE_DIGEST = `sha256:${'4'.repeat(64)}`;

export function fixtureManifest(models = ['openrouter/openai/gpt-oss:free']): ComparisonManifestV1 {
  return {
    schemaVersion: 1,
    comparisonId: 'pgup-ai/jbot-review-arena:pr-1:comment-99',
    arena: {
      repository: 'pgup-ai/jbot-review-arena',
      prNumber: 1,
      commandCommentId: 99,
      workflowRunId: 123,
      runAttempt: 1,
    },
    target: {
      url: 'https://github.com/acme/widget/pull/7',
      owner: 'acme',
      repository: 'widget',
      prNumber: 7,
      title: 'Target title',
      body: 'Target body',
      base: {
        repository: 'acme/widget',
        cloneUrl: 'https://github.com/acme/widget.git',
        ref: 'main',
        sha: BASE_SHA,
      },
      head: {
        repository: 'contributor/widget',
        cloneUrl: 'https://github.com/contributor/widget.git',
        ref: 'feature',
        sha: HEAD_SHA,
      },
    },
    jbot: {
      commitSha: JBOT_SHA,
      imageRef: `ghcr.io/pgup-ai/jbot-review:${JBOT_SHA}`,
      imageDigest: IMAGE_DIGEST,
    },
    reviewConfig: DEFAULT_REVIEW_CONFIG,
    models: models.map((model, index) => ({
      index,
      model,
      provider: model.split('/')[0]!,
      credentialAlias: model.startsWith('nvidia/') ? 'NVIDIA_API_KEY' : 'OPENROUTER_API_KEY',
      fallbackCredentialAlias: '',
      baseUrlAlias: '',
      artifactName: arenaArtifactName(index, model),
    })),
  };
}

export function completedResult(manifest: ComparisonManifestV1, modelIndex = 0): ArenaResultV1 {
  const model = manifest.models[modelIndex]!;
  return {
    schemaVersion: 1,
    comparisonId: manifest.comparisonId,
    modelIndex,
    model: model.model,
    provider: model.provider,
    status: 'completed',
    provenance: {
      targetBaseSha: manifest.target.base.sha,
      targetHeadSha: manifest.target.head.sha,
      jbotCommitSha: manifest.jbot.commitSha,
      imageRef: manifest.jbot.imageRef,
      imageDigest: manifest.jbot.imageDigest,
      backend: 'opencode',
      sdkEngine: 'pi',
      workflowRunId: manifest.arena.workflowRunId,
      runAttempt: manifest.arena.runAttempt,
      reviewConfig: manifest.reviewConfig,
      resolvedModelOptions: null,
    },
    timing: { reviewMs: 100, workerMs: 200 },
    usage: {
      sessions: 1,
      inputTokens: { value: 10, reportingSessions: 1 },
      outputTokens: { value: 5, reportingSessions: 1 },
      reasoningTokens: { value: null, reportingSessions: 0 },
      cacheReadTokens: { value: 2, reportingSessions: 1 },
      cost: { usd: 0, source: 'provider', reportingSessions: 1 },
    },
    review: { summary: 'Summary', findings: [] },
    failure: null,
  };
}
