import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import {
  DEFAULT_REVIEW_CONFIG,
  arenaArtifactName,
  validateManifest,
  type ComparisonManifestV1,
} from './contract.ts';
import { assertAuthorizedArenaComment, parseCompareCommand } from './command.ts';
import { getPublicPullRequest, type GitHubPullRequest } from './github.ts';
import { resolveJbotAuthRoutes, type JbotAuthRouteV1 } from './jbot-auth.ts';

interface PrepareInput {
  event: Record<string, unknown>;
  arenaRepository: string;
  workflowRunId: number;
  runAttempt: number;
  jbotCommitSha: string;
  imageRepository: string;
  imageDigest: string;
  resolvePull: (owner: string, repo: string, number: number) => Promise<GitHubPullRequest>;
  resolveAuthRoutes: (models: string[]) => Promise<JbotAuthRouteV1[]>;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Missing ${label}.`);
  return value as Record<string, unknown>;
}

function requiredInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

export async function prepareComparison(input: PrepareInput): Promise<ComparisonManifestV1> {
  assertAuthorizedArenaComment(input.event);
  const issue = requiredRecord(input.event.issue, 'event.issue');
  const comment = requiredRecord(input.event.comment, 'event.comment');
  const command = parseCompareCommand(String(comment.body ?? ''));
  const pull = await input.resolvePull(
    command.target.owner,
    command.target.repository,
    command.target.prNumber,
  );
  if (
    pull.html_url.toLowerCase() !== command.target.url.toLowerCase() ||
    pull.number !== command.target.prNumber
  ) {
    throw new Error('Target PR response does not match the requested URL.');
  }
  const [targetOwner, targetRepository] = pull.base.repo.full_name.split('/');
  if (!targetOwner || !targetRepository) throw new Error('Target repository identity is invalid.');
  const commandCommentId = requiredInteger(comment.id, 'comment.id');
  const arenaPrNumber = requiredInteger(issue.number, 'issue.number');
  const authRoutes = await input.resolveAuthRoutes(command.models);
  const models = command.models.map((model, index) => {
    const route = authRoutes[index]!;
    return {
      index,
      model,
      provider: route.provider,
      credentialAlias: route.credentialAlias,
      fallbackCredentialAlias: route.fallbackCredentialAlias,
      baseUrlAlias: route.baseUrlAlias,
      artifactName: arenaArtifactName(index, model),
    };
  });
  return validateManifest({
    schemaVersion: 1,
    comparisonId: `${input.arenaRepository}:pr-${arenaPrNumber}:comment-${commandCommentId}`,
    arena: {
      repository: input.arenaRepository,
      prNumber: arenaPrNumber,
      commandCommentId,
      workflowRunId: input.workflowRunId,
      runAttempt: input.runAttempt,
    },
    target: {
      url: pull.html_url,
      owner: targetOwner,
      repository: targetRepository,
      prNumber: pull.number,
      title: pull.title,
      body: pull.body ?? '',
      base: {
        repository: pull.base.repo.full_name,
        cloneUrl: pull.base.repo.clone_url,
        ref: pull.base.ref,
        sha: pull.base.sha,
      },
      head: {
        repository: pull.head.repo!.full_name,
        cloneUrl: pull.head.repo!.clone_url,
        ref: pull.head.ref,
        sha: pull.head.sha,
      },
    },
    jbot: {
      commitSha: input.jbotCommitSha,
      imageRef: `${input.imageRepository}:${input.jbotCommitSha}`,
      imageDigest: input.imageDigest,
    },
    reviewConfig: DEFAULT_REVIEW_CONFIG,
    models,
  });
}

async function main(): Promise<void> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const token = process.env.GITHUB_TOKEN;
  const outputPath = process.env.COMPARISON_OUTPUT;
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!eventPath || !token || !outputPath || !githubOutput)
    throw new Error('Missing prepare environment.');
  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as Record<string, unknown>;
  const manifest = await prepareComparison({
    event,
    arenaRepository: process.env.GITHUB_REPOSITORY ?? '',
    workflowRunId: Number(process.env.GITHUB_RUN_ID),
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    jbotCommitSha: process.env.JBOT_COMMIT_SHA ?? '',
    imageRepository: process.env.JBOT_IMAGE_REPOSITORY ?? '',
    imageDigest: process.env.JBOT_IMAGE_DIGEST ?? '',
    resolvePull: (owner, repo, number) => getPublicPullRequest(owner, repo, number, token),
    resolveAuthRoutes: async (models) =>
      resolveJbotAuthRoutes(
        `${process.env.JBOT_IMAGE_REPOSITORY}@${process.env.JBOT_IMAGE_DIGEST}`,
        models,
      ),
  });
  writeFileSync(outputPath, `${JSON.stringify(manifest)}\n`, { flag: 'wx' });
  appendFileSync(
    githubOutput,
    `matrix=${JSON.stringify({ include: manifest.models })}\ncomparison_id=${manifest.comparisonId}\n`,
  );
}

if (process.argv[1]?.endsWith('/prepare.js') || process.argv[1]?.endsWith('/prepare.ts')) {
  await main();
}
