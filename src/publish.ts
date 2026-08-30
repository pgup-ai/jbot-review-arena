import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  emptyUsage,
  parseManifest,
  sanitizeFailureMessage,
  validateArenaResult,
  type ArenaFindingV1,
  type ArenaResultV1,
  type ComparisonManifestV1,
  type ComparisonModelV1,
} from './contract.ts';
import { githubRequest } from './github.ts';

const COMMENT_BUDGET = 60 * 1024;
const FIELD_CHUNK_BUDGET = 32 * 1024;
const TITLE_BUDGET = 4 * 1024;
const BOT_LOGIN = 'github-actions[bot]';

interface IssueComment {
  id: number;
  body: string;
  user: { login: string; type: string };
}

function utf8Chunks(text: string, maxBytes: number): string[] {
  if (!text) return [''];
  const chunks: string[] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes && current.length > 0) {
      chunks.push(current.join(''));
      current = [];
      bytes = 0;
    }
    current.push(character);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current.join(''));
  return chunks;
}

export function safeMarkdown(text: string): string {
  return text
    .replace(/@(?=[A-Za-z0-9_-])/g, '@\u200b')
    .replace(/(^|\W)#(?=\d)/g, '$1#\u200b')
    .replaceAll('<', '<\u200b')
    .replaceAll('![', '!\u200b[')
    .replaceAll('](', ']\u200b(')
    .replaceAll('][', ']\u200b[')
    .replaceAll(']:', ']\u200b:')
    .replace(/\b(?:https?|ftp):\/\//gi, (url) => url.replace(':', ':\u200b'))
    .replace(/\bwww\./gi, (url) => `w\u200b${url.slice(1)}`);
}

function markdownBlocks(label: string, text: string): string[] {
  const chunks = utf8Chunks(safeMarkdown(text), FIELD_CHUNK_BUDGET);
  return chunks.map(
    (chunk, index) =>
      `### ${label}${chunks.length > 1 ? ` · ${index + 1}/${chunks.length}` : ''}\n\n${chunk}`,
  );
}

function modelHash(model: string): string {
  return createHash('sha256').update(model).digest('hex');
}

export function summaryMarker(commandCommentId: number): string {
  return `<!-- jbot-compare:comment=${commandCommentId}:summary -->`;
}

export function modelMarker(commandCommentId: number, model: string, part: number): string {
  return `<!-- jbot-compare:comment=${commandCommentId}:model=${modelHash(model)}:part=${part} -->`;
}

function metric(value: number | null, reporting: number, sessions: number): string {
  const rendered = value === null ? 'n/a' : String(value);
  return `${rendered} (${reporting}/${sessions})`;
}

function findingCounts(result: ArenaResultV1): string {
  const counts = new Map(['P0', 'P1', 'P2', 'P3', 'nit'].map((severity) => [severity, 0]));
  for (const finding of result.review?.findings ?? [])
    counts.set(finding.severity, counts.get(finding.severity)! + 1);
  return [...counts].map(([severity, count]) => `${severity}:${count}`).join(' ');
}

export function renderSummary(
  manifest: ComparisonManifestV1,
  results: ArenaResultV1[],
  historical: boolean,
): string {
  const rows = results.map((result) => {
    const cost = result.usage.cost.usd === null ? 'n/a' : `$${result.usage.cost.usd.toFixed(6)}`;
    return `| \`${result.model}\` | ${result.status} | ${result.timing.reviewMs ?? 'n/a'} | ${result.timing.workerMs} | ${findingCounts(result)} | ${metric(result.usage.inputTokens.value, result.usage.inputTokens.reportingSessions, result.usage.sessions)} | ${metric(result.usage.outputTokens.value, result.usage.outputTokens.reportingSessions, result.usage.sessions)} | ${cost} (${result.usage.cost.source}, ${result.usage.cost.reportingSessions}/${result.usage.sessions}) |`;
  });
  return `${summaryMarker(manifest.arena.commandCommentId)}
## J-Bot model comparison

Target: [${manifest.target.owner}/${manifest.target.repository}#${manifest.target.prNumber}](${manifest.target.url})<br>
Frozen head: \`${manifest.target.head.sha}\`<br>
Image: \`${manifest.jbot.imageDigest}\`${historical ? '  \n\n> The target PR advanced after preparation; these results are a historical snapshot.' : ''}

| Model | Status | Review ms | Worker ms | Findings | Input tokens | Output tokens | Cost |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
${rows.join('\n')}

Latency is observed under concurrent model load.`;
}

function targetLocation(manifest: ComparisonManifestV1, finding: ArenaFindingV1): string {
  const repository = manifest.target.head.repository.split('/').map(encodeURIComponent).join('/');
  const path = finding.path.split('/').map(encodeURIComponent).join('/');
  const line = finding.line > 0 ? `#L${finding.line}` : '';
  return `https://github.com/${repository}/blob/${manifest.target.head.sha}/${path}${line}`;
}

function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${text} ${fence}`;
}

function reportBlocks(manifest: ComparisonManifestV1, result: ArenaResultV1): string[] {
  if (result.failure)
    return markdownBlocks('Failure', `**${result.failure.class}**\n\n${result.failure.message}`);
  if (!result.review) return ['### Result\n\nSkipped: no reviewable changes.'];
  const blocks = result.review.summary.trim()
    ? markdownBlocks('Summary', result.review.summary)
    : result.review.findings.length === 0
      ? ['No findings reported.']
      : [];
  result.review.findings.forEach((finding, index) => {
    const titleChunks = utf8Chunks(
      safeMarkdown(finding.title.replace(/[\r\n]+/g, ' ')),
      TITLE_BUDGET,
    );
    const title = `${titleChunks[0]}${titleChunks.length > 1 ? '…' : ''}`;
    const location = `${finding.path}:${finding.line}`;
    const details = utf8Chunks(safeMarkdown(finding.body), FIELD_CHUNK_BUDGET);
    const evidence = finding.evidence
      ? utf8Chunks(safeMarkdown(finding.evidence), FIELD_CHUNK_BUDGET)
      : [];
    blocks.push(
      `### ${index + 1}. ${finding.severity} · ${title}\n\n[${inlineCode(location)}](${targetLocation(manifest, finding)})\n\n${details[0]}`,
      ...details
        .slice(1)
        .map(
          (detail, detailIndex) =>
            `#### Details · ${detailIndex + 2}/${details.length}\n\n${detail}`,
        ),
      ...evidence.map(
        (chunk, evidenceIndex) =>
          `**Evidence${evidence.length > 1 ? ` · ${evidenceIndex + 1}/${evidence.length}` : ''}**\n\n${chunk}`,
      ),
    );
  });
  return blocks;
}

export function renderModelReportParts(
  manifest: ComparisonManifestV1,
  result: ArenaResultV1,
): string[] {
  const blocks = reportBlocks(manifest, result);
  const groups: string[][] = [[]];
  for (const block of blocks) {
    const current = groups.at(-1)!;
    const estimate = `${modelMarker(manifest.arena.commandCommentId, result.model, groups.length)}\n## \`${result.model}\`\n\n${[...current, block].join('\n\n')}`;
    if (current.length > 0 && Buffer.byteLength(estimate) > COMMENT_BUDGET) groups.push([block]);
    else current.push(block);
  }
  return groups.map((group, index) => {
    const part = groups.length > 1 ? ` · ${index + 1}/${groups.length}` : '';
    const body = `${modelMarker(manifest.arena.commandCommentId, result.model, index + 1)}\n## \`${result.model}\`${part}\n\n${group.join('\n\n')}`;
    if (Buffer.byteLength(body) > COMMENT_BUDGET)
      throw new Error('Rendered model report exceeds the comment budget.');
    return body;
  });
}

function missingResult(manifest: ComparisonManifestV1, model: ComparisonModelV1): ArenaResultV1 {
  return validateArenaResult(
    {
      schemaVersion: 1,
      comparisonId: manifest.comparisonId,
      modelIndex: model.index,
      model: model.model,
      provider: model.provider,
      status: 'failed',
      provenance: {
        targetBaseSha: manifest.target.base.sha,
        targetHeadSha: manifest.target.head.sha,
        imageRef: manifest.jbot.imageRef,
        imageDigest: manifest.jbot.imageDigest,
        backend: null,
        sdkEngine: null,
        workflowRunId: manifest.arena.workflowRunId,
        runAttempt: manifest.arena.runAttempt,
        reviewConfig: manifest.reviewConfig,
        resolvedModelOptions: null,
      },
      timing: { reviewMs: null, workerMs: 0 },
      usage: emptyUsage(),
      review: null,
      failure: { class: 'missing-artifact', message: 'Worker did not upload a result artifact.' },
    },
    manifest,
  );
}

export function loadResults(
  manifest: ComparisonManifestV1,
  artifactsRoot: string,
): ArenaResultV1[] {
  return manifest.models.map((model) => {
    try {
      const raw = readFileSync(join(artifactsRoot, model.artifactName, 'result.json'), 'utf8');
      return validateArenaResult(JSON.parse(raw), manifest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return missingResult(manifest, model);
      return validateArenaResult(
        {
          ...missingResult(manifest, model),
          failure: { class: 'invalid-output', message: sanitizeFailureMessage(error) },
        },
        manifest,
      );
    }
  });
}

function exactMarker(body: string): string | undefined {
  const firstLine = body.split('\n', 1)[0] ?? '';
  return /^<!-- jbot-compare:comment=\d+:(?:summary|model=[0-9a-f]{64}:part=[1-9]\d*) -->$/.test(
    firstLine,
  )
    ? firstLine
    : undefined;
}

async function listComments(
  repository: string,
  issueNumber: number,
  token: string,
): Promise<IssueComment[]> {
  const [owner, repo] = repository.split('/');
  const comments: IssueComment[] = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest<IssueComment[]>(
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
      token,
    );
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

export async function reconcileComments(params: {
  repository: string;
  issueNumber: number;
  commandCommentId: number;
  desiredBodies: string[];
  token: string;
}): Promise<void> {
  const [owner, repo] = params.repository.split('/');
  const desired = new Map(params.desiredBodies.map((body) => [exactMarker(body)!, body]));
  if ([...desired.keys()].some((marker) => !marker))
    throw new Error('Publisher generated an invalid marker.');
  const comments = (await listComments(params.repository, params.issueNumber, params.token)).filter(
    (comment) => comment.user.login === BOT_LOGIN && comment.user.type === 'Bot',
  );
  const ownedPrefix = `<!-- jbot-compare:comment=${params.commandCommentId}:`;
  const byMarker = new Map<string, IssueComment[]>();
  for (const comment of comments) {
    const marker = exactMarker(comment.body);
    if (!marker?.startsWith(ownedPrefix)) continue;
    const matches = byMarker.get(marker) ?? [];
    matches.push(comment);
    byMarker.set(marker, matches);
  }
  const deleteIds: number[] = [];
  for (const [marker, body] of desired) {
    const matches = (byMarker.get(marker) ?? []).sort((a, b) => a.id - b.id);
    const canonical = matches.shift();
    if (canonical) {
      if (canonical.body !== body) {
        await githubRequest(
          `/repos/${owner}/${repo}/issues/comments/${canonical.id}`,
          params.token,
          {
            method: 'PATCH',
            body: JSON.stringify({ body }),
          },
        );
      }
      deleteIds.push(...matches.map(({ id }) => id));
    } else {
      await githubRequest(
        `/repos/${owner}/${repo}/issues/${params.issueNumber}/comments`,
        params.token,
        {
          method: 'POST',
          body: JSON.stringify({ body }),
        },
      );
    }
  }
  for (const [marker, matches] of byMarker) {
    if (!desired.has(marker)) deleteIds.push(...matches.map(({ id }) => id));
  }
  for (const id of deleteIds) {
    await githubRequest(`/repos/${owner}/${repo}/issues/comments/${id}`, params.token, {
      method: 'DELETE',
    });
  }
}

async function main(): Promise<void> {
  const manifestPath = process.env.COMPARISON_MANIFEST;
  const artifactsRoot = process.env.ARTIFACTS_ROOT;
  const token = process.env.GITHUB_TOKEN;
  if (!manifestPath || !artifactsRoot || !token) throw new Error('Missing publisher environment.');
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const results = loadResults(manifest, artifactsRoot);
  const current = await githubRequest<{ head: { sha: string } }>(
    `/repos/${manifest.target.owner}/${manifest.target.repository}/pulls/${manifest.target.prNumber}`,
    token,
  );
  const desiredBodies = [
    renderSummary(manifest, results, current.head.sha !== manifest.target.head.sha),
    ...results.flatMap((result) => renderModelReportParts(manifest, result)),
  ];
  await reconcileComments({
    repository: manifest.arena.repository,
    issueNumber: manifest.arena.prNumber,
    commandCommentId: manifest.arena.commandCommentId,
    desiredBodies,
    token,
  });
}

if (process.argv[1]?.endsWith('/publish.js') || process.argv[1]?.endsWith('/publish.ts')) {
  await main();
}
