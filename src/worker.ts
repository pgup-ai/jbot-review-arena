import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  emptyUsage,
  expandSecretsForRedaction,
  parseJbotOutput,
  parseManifest,
  redactSecrets,
  redactSecretsFromValue,
  redactReviewSecrets,
  sanitizeFailureMessage,
  validateArenaResult,
  type ArenaFailureClass,
  type ArenaResultV1,
  type ComparisonManifestV1,
  type ComparisonModelV1,
  type JbotArenaOutputV1,
} from './contract.ts';

class WorkerFailure extends Error {
  constructor(
    readonly failureClass: ArenaFailureClass,
    message: string,
  ) {
    super(message);
  }
}

const SECRETS_ENV = 'JBOT_AUTH_JSON';
const GITHUB_TOKEN_NAMES = new Set(['GITHUB_TOKEN', 'GH_TOKEN']);

export function readJbotAuthEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const raw = env[SECRETS_ENV]?.trim();
  if (!raw) return {};
  let secrets: unknown;
  try {
    secrets = JSON.parse(raw);
  } catch {
    throw new Error(`${SECRETS_ENV} must be valid JSON.`);
  }
  if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
    throw new Error(`${SECRETS_ENV} must be a JSON object.`);
  }
  return Object.fromEntries(
    Object.entries(secrets).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' &&
        Boolean(entry[1]) &&
        /^[A-Z][A-Z0-9_]*$/.test(entry[0]) &&
        !GITHUB_TOKEN_NAMES.has(entry[0]),
    ),
  );
}

function run(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

export function materializeTarget(manifest: ComparisonManifestV1, workspace: string): void {
  mkdirSync(workspace, { recursive: true });
  try {
    run('git', ['init', '-q', '-b', 'arena', workspace]);
    run('git', ['remote', 'add', 'head', manifest.target.head.cloneUrl], workspace);
    run('git', ['remote', 'add', 'base', manifest.target.base.cloneUrl], workspace);
    run(
      'git',
      ['fetch', '--quiet', '--filter=blob:none', '--no-tags', 'head', manifest.target.head.sha],
      workspace,
    );
    run(
      'git',
      ['fetch', '--quiet', '--filter=blob:none', '--no-tags', 'base', manifest.target.base.sha],
      workspace,
    );
    run('git', ['checkout', '--quiet', '--detach', manifest.target.head.sha], workspace);
    if (run('git', ['rev-parse', 'HEAD'], workspace) !== manifest.target.head.sha) {
      throw new Error('Checkout HEAD does not match the frozen target head.');
    }
    run('git', ['cat-file', '-e', `${manifest.target.base.sha}^{commit}`], workspace);
    run('git', ['merge-base', manifest.target.base.sha, manifest.target.head.sha], workspace);
    if (run('git', ['status', '--porcelain=v1', '--untracked-files=all'], workspace)) {
      throw new Error('Target checkout is dirty.');
    }
  } catch (error) {
    throw new WorkerFailure('checkout', sanitizeFailureMessage(error));
  }
}

export function dockerRunArgs(
  manifest: ComparisonManifestV1,
  workspace: string,
  manifestPath: string,
  outputDirectory: string,
): string[] {
  const args = [
    'run',
    '--rm',
    '--workdir',
    '/workspace',
    '--mount',
    `type=bind,src=${workspace},dst=/workspace,readonly`,
    '--mount',
    `type=bind,src=${manifestPath},dst=/run/jbot-comparison/comparison.json,readonly`,
    '--mount',
    `type=bind,src=${outputDirectory},dst=/out`,
    '--env',
    'MODEL',
    '--env',
    SECRETS_ENV,
  ];
  return [
    ...args,
    '--entrypoint',
    'node',
    `${manifest.jbot.imageRef.split(':').slice(0, -1).join(':')}@${manifest.jbot.imageDigest}`,
    '/app/dist/local/index.js',
    '--pr-context',
    '/run/jbot-comparison/comparison.json',
    '--output',
    '/out/jbot-output.json',
  ];
}

function resultFromJbot(
  manifest: ComparisonManifestV1,
  model: ComparisonModelV1,
  output: JbotArenaOutputV1,
  workerMs: number,
  secrets: string[],
): ArenaResultV1 {
  const redactionSecrets = expandSecretsForRedaction(secrets);
  return validateArenaResult(
    {
      schemaVersion: 1,
      comparisonId: manifest.comparisonId,
      modelIndex: model.index,
      model: model.model,
      provider: model.provider,
      status: output.status,
      provenance: {
        targetBaseSha: manifest.target.base.sha,
        targetHeadSha: manifest.target.head.sha,
        jbotCommitSha: manifest.jbot.commitSha,
        imageRef: manifest.jbot.imageRef,
        imageDigest: manifest.jbot.imageDigest,
        backend: output.backend,
        sdkEngine: output.sdkEngine,
        workflowRunId: manifest.arena.workflowRunId,
        runAttempt: manifest.arena.runAttempt,
        reviewConfig: manifest.reviewConfig,
        resolvedModelOptions: redactSecretsFromValue(output.resolvedModelOptions, redactionSecrets),
      },
      timing: { reviewMs: output.reviewMs, workerMs },
      usage: output.usage,
      review: redactReviewSecrets(output.review, redactionSecrets),
      failure: output.failure
        ? {
            class: output.failure.class,
            message: sanitizeFailureMessage(output.failure.message, redactionSecrets),
          }
        : null,
    },
    manifest,
  );
}

export function failedResult(
  manifest: ComparisonManifestV1,
  model: ComparisonModelV1,
  failureClass: ArenaFailureClass,
  error: unknown,
  workerMs: number,
  secrets: string[] = [],
): ArenaResultV1 {
  const redactionSecrets = expandSecretsForRedaction(secrets);
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
        jbotCommitSha: manifest.jbot.commitSha,
        imageRef: manifest.jbot.imageRef,
        imageDigest: manifest.jbot.imageDigest,
        backend: null,
        sdkEngine: null,
        workflowRunId: manifest.arena.workflowRunId,
        runAttempt: manifest.arena.runAttempt,
        reviewConfig: manifest.reviewConfig,
        resolvedModelOptions: null,
      },
      timing: { reviewMs: null, workerMs },
      usage: emptyUsage(),
      review: null,
      failure: {
        class: failureClass,
        message: sanitizeFailureMessage(error, redactionSecrets),
      },
    },
    manifest,
  );
}

function pullAndVerifyImage(manifest: ComparisonManifestV1): void {
  const pinned = `${manifest.jbot.imageRef.split(':').slice(0, -1).join(':')}@${manifest.jbot.imageDigest}`;
  try {
    run('docker', ['pull', '--quiet', pinned]);
    const digests = run('docker', [
      'image',
      'inspect',
      pinned,
      '--format',
      '{{join .RepoDigests "\n"}}',
    ]);
    if (!digests.split('\n').some((item) => item.endsWith(`@${manifest.jbot.imageDigest}`))) {
      throw new Error('Pulled image does not expose the frozen registry digest.');
    }
  } catch (error) {
    throw new WorkerFailure('image', sanitizeFailureMessage(error));
  }
}

export function runArenaWorker(params: {
  manifest: ComparisonManifestV1;
  model: ComparisonModelV1;
  manifestPath: string;
  workRoot: string;
  authEnvironment: Record<string, string>;
}): ArenaResultV1 {
  const startedAt = performance.now();
  const workspace = resolve(params.workRoot, 'workspace');
  const outputDirectory = resolve(params.workRoot, 'output');
  mkdirSync(outputDirectory, { recursive: true });
  const secrets = Object.values(params.authEnvironment);
  try {
    materializeTarget(params.manifest, workspace);
    pullAndVerifyImage(params.manifest);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [SECRETS_ENV]: JSON.stringify(params.authEnvironment),
      MODEL: params.model.model,
    };
    const timeout = (params.manifest.reviewConfig.timeBudgetMinutes + 5) * 60_000;
    const child = spawnSync(
      'docker',
      dockerRunArgs(params.manifest, workspace, resolve(params.manifestPath), outputDirectory),
      { env, encoding: 'utf8', stdio: 'pipe', timeout, maxBuffer: 4 * 1024 * 1024 },
    );
    const workerMs = Math.round(performance.now() - startedAt);
    const jbotOutputPath = join(outputDirectory, 'jbot-output.json');
    let output: JbotArenaOutputV1;
    try {
      output = parseJbotOutput(readFileSync(jbotOutputPath, 'utf8'));
    } catch (error) {
      const timedOut =
        (child.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' ||
        /timed out/i.test(child.error?.message ?? '');
      const failureClass = timedOut
        ? 'timeout'
        : child.signal
          ? 'signal'
          : child.status === 0
            ? 'invalid-output'
            : 'runner-exit';
      return failedResult(
        params.manifest,
        params.model,
        failureClass,
        child.stderr || child.error || error,
        workerMs,
        secrets,
      );
    }
    if (child.status !== 0 && output.status !== 'failed') {
      return failedResult(
        params.manifest,
        params.model,
        child.signal ? 'signal' : 'runner-exit',
        child.stderr || `J-Bot exited ${child.status}.`,
        workerMs,
        secrets,
      );
    }
    return resultFromJbot(params.manifest, params.model, output, workerMs, secrets);
  } catch (error) {
    const failureClass = error instanceof WorkerFailure ? error.failureClass : 'unknown';
    return failedResult(
      params.manifest,
      params.model,
      failureClass,
      error,
      Math.round(performance.now() - startedAt),
      secrets,
    );
  }
}

function renderRawReview(result: ArenaResultV1): string {
  if (!result.review) return `# ${result.model}\n\n${result.failure?.message ?? result.status}\n`;
  const findings = result.review.findings
    .map(
      (finding) =>
        `## ${finding.severity}: ${finding.title}\n\n${finding.path}:${finding.line}\n\n${finding.body}`,
    )
    .join('\n\n');
  return `# ${result.model}\n\n${result.review.summary}\n\n${findings}\n`;
}

function main(): void {
  const manifestPath = process.env.COMPARISON_MANIFEST;
  const artifactDirectory = process.env.ARTIFACT_DIRECTORY;
  const workRoot = process.env.RUNNER_TEMP
    ? join(process.env.RUNNER_TEMP, 'jbot-worker')
    : undefined;
  if (!manifestPath || !artifactDirectory || !workRoot)
    throw new Error('Missing worker environment.');
  const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
  const modelIndex = Number(process.env.MODEL_INDEX);
  const model = manifest.models[modelIndex];
  if (!model) throw new Error('MODEL_INDEX is not present in the comparison manifest.');
  const authEnvironment = readJbotAuthEnvironment(process.env);
  mkdirSync(artifactDirectory, { recursive: true });
  const result = runArenaWorker({
    manifest,
    model,
    manifestPath,
    workRoot,
    authEnvironment,
  });
  writeFileSync(join(artifactDirectory, 'result.json'), `${JSON.stringify(result)}\n`, {
    flag: 'wx',
  });
  writeFileSync(join(artifactDirectory, 'review.md'), renderRawReview(result), { flag: 'wx' });
  const telemetryPath = join(workRoot, 'output', 'telemetry.jsonl');
  try {
    const telemetry = readFileSync(telemetryPath, 'utf8');
    writeFileSync(
      join(artifactDirectory, 'telemetry.jsonl'),
      redactSecrets(telemetry, expandSecretsForRedaction(Object.values(authEnvironment))),
    );
  } catch {
    // Telemetry is unavailable for setup failures and some opaque backends.
  }
}

if (process.argv[1]?.endsWith('/worker.js') || process.argv[1]?.endsWith('/worker.ts')) main();
