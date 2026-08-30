import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  arenaArtifactName,
  expandSecretsForRedaction,
  parseJbotOutput,
  parseManifest,
  redactReviewSecrets,
  redactSecretsFromValue,
  sanitizeFailureMessage,
  validateArenaResult,
} from '../src/contract.ts';
import { completedResult, fixtureManifest } from './helpers.ts';

describe('versioned contracts', () => {
  it('round-trips a manifest and binds artifact names to index plus model hash', () => {
    const manifest = fixtureManifest();
    assert.deepEqual(parseManifest(JSON.stringify(manifest)), manifest);
    assert.equal(manifest.models[0]!.artifactName, arenaArtifactName(0, manifest.models[0]!.model));
    const invalid = structuredClone(manifest);
    invalid.models[0]!.artifactName = 'model-0-user-input';
    assert.throws(() => parseManifest(JSON.stringify(invalid)), /inconsistent/);
    const substitutedImage = structuredClone(manifest);
    substitutedImage.jbot.imageRef = 'ghcr.io/attacker/image:latest';
    assert.throws(() => parseManifest(JSON.stringify(substitutedImage)), /imageRef/);
    const changedConfig = structuredClone(manifest);
    changedConfig.reviewConfig.dryRun = false as true;
    assert.throws(() => parseManifest(JSON.stringify(changedConfig)), /dryRun/);
    const unsafeModel = structuredClone(manifest);
    unsafeModel.models[0]!.model = 'openrouter/a`\n@team';
    assert.throws(() => parseManifest(JSON.stringify(unsafeModel)), /model is invalid/);
  });

  it('validates status invariants, metric completeness, provenance, and finding paths', () => {
    const manifest = fixtureManifest();
    assert.deepEqual(
      validateArenaResult(completedResult(manifest), manifest),
      completedResult(manifest),
    );
    const invalid = completedResult(manifest);
    invalid.usage.inputTokens.reportingSessions = 2;
    assert.throws(() => validateArenaResult(invalid, manifest), /inconsistent/);
    const incomplete = completedResult(manifest);
    incomplete.usage.outputTokens.reportingSessions = 0;
    assert.throws(() => validateArenaResult(incomplete, manifest), /inconsistent/);
    const unsafe = completedResult(manifest);
    unsafe.review!.findings.push({
      path: '../secret',
      line: 1,
      severity: 'P1',
      title: 'x',
      body: 'x',
    });
    assert.throws(() => validateArenaResult(unsafe, manifest), /unsafe/);
    const unknownFailure = {
      ...completedResult(manifest),
      status: 'failed',
      review: null,
      failure: { class: 'made-up', message: 'x' },
    };
    assert.throws(() => validateArenaResult(unknownFailure, manifest), /failure class/);
  });

  it('accepts J-Bot terminal output and scrubs bounded credential-shaped failures', () => {
    const result = completedResult(fixtureManifest());
    assert.equal(
      parseJbotOutput(
        JSON.stringify({
          schemaVersion: 1,
          status: 'completed',
          backend: result.provenance.backend,
          sdkEngine: result.provenance.sdkEngine,
          resolvedModelOptions: null,
          reviewMs: result.timing.reviewMs,
          usage: result.usage,
          review: result.review,
          failure: null,
        }),
      ).status,
      'completed',
    );
    const sanitized = sanitizeFailureMessage(
      new Error('Bearer bearer-value {"token":"json-value"}\nhttps://user:pass@example.com'),
    );
    assert.doesNotMatch(sanitized, /bearer-value|json-value|user:pass|[\r\n]/);
    assert.ok(Buffer.byteLength(sanitized) <= 512);
  });

  it('redacts nested structured credentials without mutating review enums', () => {
    assert.deepEqual(redactSecretsFromValue({ token: ['prefix-secret', 1] }, ['secret']), {
      token: ['prefix-[REDACTED]', 1],
    });
    const secrets = expandSecretsForRedaction([
      '{"access_token":"nested-secret","authorization":"Bearer authorization-secret","metadata":"provider"}',
      'security',
    ]);
    assert.ok(secrets.includes('nested-secret'));
    assert.ok(secrets.includes('Bearer authorization-secret'));
    assert.ok(!secrets.includes('provider'));
    const review = redactReviewSecrets(
      {
        summary: 'nested-secret',
        findings: [
          {
            path: 'src/file.ts',
            line: 1,
            severity: 'P1',
            kind: 'security',
            title: 'nested-secret',
            body: 'body',
          },
        ],
      },
      secrets,
    )!;
    assert.equal(review.summary, '[REDACTED]');
    assert.equal(review.findings[0]!.title, '[REDACTED]');
    assert.equal(review.findings[0]!.kind, 'security');
  });
});
