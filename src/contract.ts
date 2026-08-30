import { createHash } from 'node:crypto';

export type Severity = 'P0' | 'P1' | 'P2' | 'P3' | 'nit';
export type ArenaResultStatus = 'completed' | 'skipped' | 'failed';
export type ArenaFailureClass =
  | 'checkout'
  | 'image'
  | 'timeout'
  | 'provider'
  | 'parse'
  | 'runner-exit'
  | 'signal'
  | 'invalid-output'
  | 'missing-artifact'
  | 'unknown';

export interface ReviewConfigV1 {
  enhancedContext: true;
  dryRun: true;
  autoApprove: false;
  maxFindings: number;
  minSeverity: Severity;
  includePriorComments: false;
  context7Mode: 'auto' | 'always' | 'off';
  guidelinePass: boolean;
  shardCache: false;
  scrubSessionEnv: true;
  auxModelMode: 'same-as-main';
  sdkEngine: 'auto' | 'opencode';
  reviewPasses: number;
  verifyFindings: boolean;
  timeBudgetMinutes: number;
  reviewShards: number;
  dynamicFanout: boolean;
  modelOptions: Record<string, unknown> | null;
  promptCache: boolean;
  skipDocOnly: boolean;
  maxConcurrentSessions: number;
  reviewTelemetry: true;
  evidenceQuotes: boolean;
  contextTrim: boolean;
  embeddedFirstPrompt: boolean;
  guidelineWiden: 'auto' | 'full';
  verifierSlimContext: boolean;
  verifyOverlapGrace: boolean;
}

export interface ComparisonModelV1 {
  index: number;
  model: string;
  provider: string;
  artifactName: string;
}

export interface ComparisonManifestV1 {
  schemaVersion: 1;
  comparisonId: string;
  arena: {
    repository: string;
    prNumber: number;
    commandCommentId: number;
    workflowRunId: number;
    runAttempt: number;
  };
  target: {
    url: string;
    owner: string;
    repository: string;
    prNumber: number;
    title: string;
    body: string;
    base: { repository: string; cloneUrl: string; ref: string; sha: string };
    head: { repository: string; cloneUrl: string; ref: string; sha: string };
  };
  jbot: { imageRef: string; imageDigest: string };
  reviewConfig: ReviewConfigV1;
  models: ComparisonModelV1[];
}

export interface ArenaFindingV1 {
  path: string;
  line: number;
  severity: Severity;
  kind?:
    | 'bug'
    | 'security'
    | 'performance'
    | 'maintainability'
    | 'architecture'
    | 'test'
    | 'docs'
    | 'investigate';
  confidence?: 'high' | 'medium' | 'low';
  title: string;
  body: string;
  evidence?: string;
}

export interface ArenaUsageV1 {
  sessions: number;
  inputTokens: { value: number | null; reportingSessions: number };
  outputTokens: { value: number | null; reportingSessions: number };
  reasoningTokens: { value: number | null; reportingSessions: number };
  cacheReadTokens: { value: number | null; reportingSessions: number };
  cost: {
    usd: number | null;
    source: 'provider' | 'configured-estimate' | 'mixed' | 'unavailable';
    reportingSessions: number;
  };
}

export interface ArenaResultV1 {
  schemaVersion: 1;
  comparisonId: string;
  modelIndex: number;
  model: string;
  provider: string;
  status: ArenaResultStatus;
  provenance: {
    targetBaseSha: string;
    targetHeadSha: string;
    imageRef: string;
    imageDigest: string;
    backend: string | null;
    sdkEngine: string | null;
    workflowRunId: number;
    runAttempt: number;
    reviewConfig: ReviewConfigV1;
    resolvedModelOptions: Record<string, unknown> | null;
  };
  timing: { reviewMs: number | null; workerMs: number };
  usage: ArenaUsageV1;
  review: { summary: string; findings: ArenaFindingV1[] } | null;
  failure: { class: ArenaFailureClass; message: string } | null;
}

export interface JbotArenaOutputV1 {
  schemaVersion: 1;
  status: ArenaResultStatus;
  backend: string | null;
  sdkEngine: string | null;
  resolvedModelOptions: Record<string, unknown> | null;
  reviewMs: number | null;
  usage: ArenaUsageV1;
  review: ArenaResultV1['review'];
  failure: { class: 'timeout' | 'provider' | 'parse' | 'unknown'; message: string } | null;
}

export const DEFAULT_REVIEW_CONFIG: ReviewConfigV1 = {
  enhancedContext: true,
  dryRun: true,
  autoApprove: false,
  maxFindings: 0,
  minSeverity: 'nit',
  includePriorComments: false,
  context7Mode: 'auto',
  guidelinePass: true,
  shardCache: false,
  scrubSessionEnv: true,
  auxModelMode: 'same-as-main',
  sdkEngine: 'auto',
  reviewPasses: 1,
  verifyFindings: true,
  timeBudgetMinutes: 30,
  reviewShards: 0,
  dynamicFanout: true,
  modelOptions: null,
  promptCache: true,
  skipDocOnly: true,
  maxConcurrentSessions: 3,
  reviewTelemetry: true,
  evidenceQuotes: true,
  contextTrim: false,
  embeddedFirstPrompt: true,
  guidelineWiden: 'auto',
  verifierSlimContext: false,
  verifyOverlapGrace: false,
};

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}\/[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/;
const IMAGE_REPOSITORY = 'ghcr.io/pgup-ai/jbot-review';
const FAILURE_CLASSES = new Set<ArenaFailureClass>([
  'checkout',
  'image',
  'timeout',
  'provider',
  'parse',
  'runner-exit',
  'signal',
  'invalid-output',
  'missing-artifact',
  'unknown',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  return value;
}

function boundedText(value: unknown, label: string, maxBytes: number): string {
  const parsed = text(value, label);
  if (Buffer.byteLength(parsed) > maxBytes) throw new Error(`${label} is too large.`);
  return parsed;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    throw new Error(`${label} must be an integer >= ${minimum}.`);
  return Number(value);
}

function reviewConfig(input: unknown, label: string): ReviewConfigV1 {
  const value = record(input, label);
  for (const [key, expected] of Object.entries(DEFAULT_REVIEW_CONFIG)) {
    if (JSON.stringify(value[key]) !== JSON.stringify(expected)) {
      throw new Error(`${label}.${key} is invalid.`);
    }
  }
  return { ...DEFAULT_REVIEW_CONFIG };
}

export function arenaArtifactName(index: number, model: string): string {
  return `model-${index}-${createHash('sha256').update(model).digest('hex')}`;
}

export function parseManifest(raw: string): ComparisonManifestV1 {
  if (Buffer.byteLength(raw) > 256 * 1024) throw new Error('Comparison manifest is too large.');
  return validateManifest(JSON.parse(raw));
}

export function validateManifest(input: unknown): ComparisonManifestV1 {
  const value = record(input, 'comparison');
  if (value.schemaVersion !== 1) throw new Error('Unsupported comparison schemaVersion.');
  const arena = record(value.arena, 'comparison.arena');
  const target = record(value.target, 'comparison.target');
  const base = record(target.base, 'comparison.target.base');
  const head = record(target.head, 'comparison.target.head');
  const jbot = record(value.jbot, 'comparison.jbot');
  const models = value.models;
  if (!Array.isArray(models) || models.length < 1 || models.length > 8)
    throw new Error('comparison.models is invalid.');
  const parsedModels = models.map((entry, index) => {
    const model = record(entry, `comparison.models[${index}]`);
    const modelName = string(model.model, `comparison.models[${index}].model`);
    if (modelName.length > 512 || !MODEL_PATTERN.test(modelName))
      throw new Error(`comparison.models[${index}].model is invalid.`);
    const parsed = {
      index: integer(model.index, `comparison.models[${index}].index`),
      model: modelName,
      provider: string(model.provider, `comparison.models[${index}].provider`),
      artifactName: string(model.artifactName, `comparison.models[${index}].artifactName`),
    };
    if (
      parsed.index !== index ||
      parsed.provider !== modelName.split('/')[0] ||
      parsed.artifactName !== arenaArtifactName(index, modelName)
    ) {
      throw new Error(`comparison.models[${index}] is inconsistent.`);
    }
    return parsed;
  });
  const baseSha = string(base.sha, 'comparison.target.base.sha');
  const headSha = string(head.sha, 'comparison.target.head.sha');
  const imageDigest = string(jbot.imageDigest, 'comparison.jbot.imageDigest');
  if (![baseSha, headSha].every((sha) => SHA_PATTERN.test(sha)))
    throw new Error('Comparison contains an invalid SHA.');
  if (!DIGEST_PATTERN.test(imageDigest)) throw new Error('comparison.jbot.imageDigest is invalid.');
  if (new Set(parsedModels.map(({ model }) => model)).size !== parsedModels.length)
    throw new Error('comparison.models must be unique.');
  const arenaRepository = string(arena.repository, 'comparison.arena.repository');
  const arenaPrNumber = integer(arena.prNumber, 'comparison.arena.prNumber', 1);
  const commandCommentId = integer(arena.commandCommentId, 'comparison.arena.commandCommentId', 1);
  const comparisonId = string(value.comparisonId, 'comparison.comparisonId');
  if (
    !REPOSITORY_PATTERN.test(arenaRepository) ||
    comparisonId !== `${arenaRepository}:pr-${arenaPrNumber}:comment-${commandCommentId}`
  ) {
    throw new Error('Comparison arena identity is inconsistent.');
  }
  const owner = string(target.owner, 'comparison.target.owner');
  const repository = string(target.repository, 'comparison.target.repository');
  const prNumber = integer(target.prNumber, 'comparison.target.prNumber', 1);
  const targetRepository = `${owner}/${repository}`;
  if (
    !REPOSITORY_PATTERN.test(targetRepository) ||
    string(target.url, 'comparison.target.url') !==
      `https://github.com/${targetRepository}/pull/${prNumber}` ||
    string(base.repository, 'comparison.target.base.repository') !== targetRepository ||
    string(base.cloneUrl, 'comparison.target.base.cloneUrl') !==
      `https://github.com/${targetRepository}.git`
  ) {
    throw new Error('Comparison target identity is inconsistent.');
  }
  const headRepository = string(head.repository, 'comparison.target.head.repository');
  if (
    !REPOSITORY_PATTERN.test(headRepository) ||
    string(head.cloneUrl, 'comparison.target.head.cloneUrl') !==
      `https://github.com/${headRepository}.git`
  ) {
    throw new Error('Comparison head identity is inconsistent.');
  }
  const imageRef = string(jbot.imageRef, 'comparison.jbot.imageRef');
  if (imageRef !== `${IMAGE_REPOSITORY}:latest`)
    throw new Error('comparison.jbot.imageRef is inconsistent.');
  return {
    schemaVersion: 1,
    comparisonId,
    arena: {
      repository: arenaRepository,
      prNumber: arenaPrNumber,
      commandCommentId,
      workflowRunId: integer(arena.workflowRunId, 'comparison.arena.workflowRunId', 1),
      runAttempt: integer(arena.runAttempt, 'comparison.arena.runAttempt', 1),
    },
    target: {
      url: `https://github.com/${targetRepository}/pull/${prNumber}`,
      owner,
      repository,
      prNumber,
      title: boundedText(target.title, 'comparison.target.title', 1024),
      body: boundedText(target.body, 'comparison.target.body', 64 * 1024),
      base: {
        repository: targetRepository,
        cloneUrl: `https://github.com/${targetRepository}.git`,
        ref: string(base.ref, 'comparison.target.base.ref'),
        sha: baseSha,
      },
      head: {
        repository: headRepository,
        cloneUrl: `https://github.com/${headRepository}.git`,
        ref: string(head.ref, 'comparison.target.head.ref'),
        sha: headSha,
      },
    },
    jbot: {
      imageRef,
      imageDigest,
    },
    reviewConfig: reviewConfig(value.reviewConfig, 'comparison.reviewConfig'),
    models: parsedModels,
  };
}

export function emptyUsage(): ArenaUsageV1 {
  const metric = () => ({ value: null, reportingSessions: 0 });
  return {
    sessions: 0,
    inputTokens: metric(),
    outputTokens: metric(),
    reasoningTokens: metric(),
    cacheReadTokens: metric(),
    cost: { usd: null, source: 'unavailable', reportingSessions: 0 },
  };
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function nullableNumber(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`${label} is invalid.`);
  return value;
}

function validateUsage(input: unknown): ArenaUsageV1 {
  const value = record(input, 'usage');
  const sessions = integer(value.sessions, 'usage.sessions');
  const metric = (name: 'inputTokens' | 'outputTokens' | 'reasoningTokens' | 'cacheReadTokens') => {
    const item = record(value[name], `usage.${name}`);
    const reportingSessions = integer(item.reportingSessions, `usage.${name}.reportingSessions`);
    const metricValue = nullableNumber(item.value, `usage.${name}.value`);
    if (reportingSessions > sessions || (reportingSessions === 0) !== (metricValue === null))
      throw new Error(`usage.${name} is inconsistent.`);
    return { value: metricValue, reportingSessions };
  };
  const cost = record(value.cost, 'usage.cost');
  const costReporting = integer(cost.reportingSessions, 'usage.cost.reportingSessions');
  const costUsd = nullableNumber(cost.usd, 'usage.cost.usd');
  if (costReporting > sessions || (costReporting === 0) !== (costUsd === null))
    throw new Error('usage.cost is inconsistent.');
  if (!['provider', 'configured-estimate', 'mixed', 'unavailable'].includes(String(cost.source))) {
    throw new Error('usage.cost.source is invalid.');
  }
  if ((costReporting === 0) !== (cost.source === 'unavailable'))
    throw new Error('usage.cost source is inconsistent.');
  return {
    sessions,
    inputTokens: metric('inputTokens'),
    outputTokens: metric('outputTokens'),
    reasoningTokens: metric('reasoningTokens'),
    cacheReadTokens: metric('cacheReadTokens'),
    cost: {
      usd: costUsd,
      source: cost.source as ArenaUsageV1['cost']['source'],
      reportingSessions: costReporting,
    },
  };
}

function validateReview(input: unknown): ArenaResultV1['review'] {
  if (input === null) return null;
  const value = record(input, 'review');
  if (typeof value.summary !== 'string' || !Array.isArray(value.findings))
    throw new Error('review is invalid.');
  const severities = new Set<Severity>(['P0', 'P1', 'P2', 'P3', 'nit']);
  const kinds = new Set([
    'bug',
    'security',
    'performance',
    'maintainability',
    'architecture',
    'test',
    'docs',
    'investigate',
  ]);
  const confidences = new Set(['high', 'medium', 'low']);
  const findings = value.findings.map((entry, index) => {
    const finding = record(entry, `review.findings[${index}]`);
    const path = string(finding.path, `review.findings[${index}].path`);
    if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\0')) {
      throw new Error(`review.findings[${index}].path is unsafe.`);
    }
    if (!severities.has(finding.severity as Severity))
      throw new Error(`review.findings[${index}].severity is invalid.`);
    const result: ArenaFindingV1 = {
      path,
      line: integer(finding.line, `review.findings[${index}].line`),
      severity: finding.severity as Severity,
      title: text(finding.title, `review.findings[${index}].title`),
      body: text(finding.body, `review.findings[${index}].body`),
    };
    if (finding.kind !== undefined) {
      if (typeof finding.kind !== 'string' || !kinds.has(finding.kind))
        throw new Error(`review.findings[${index}].kind is invalid.`);
      result.kind = finding.kind as NonNullable<ArenaFindingV1['kind']>;
    }
    if (finding.confidence !== undefined) {
      if (typeof finding.confidence !== 'string' || !confidences.has(finding.confidence))
        throw new Error(`review.findings[${index}].confidence is invalid.`);
      result.confidence = finding.confidence as NonNullable<ArenaFindingV1['confidence']>;
    }
    if (finding.evidence !== undefined)
      result.evidence = text(finding.evidence, `review.findings[${index}].evidence`);
    return result;
  });
  return { summary: value.summary, findings };
}

function validateStatus(
  status: ArenaResultStatus,
  review: ArenaResultV1['review'],
  failure: { class: string; message: string } | null,
): void {
  if (status === 'completed' && (!review || failure))
    throw new Error('Completed output must contain only review data.');
  if (status === 'skipped' && (review || failure))
    throw new Error('Skipped output cannot contain review or failure data.');
  if (status === 'failed' && (review || !failure))
    throw new Error('Failed output must contain only failure data.');
}

export function parseJbotOutput(raw: string): JbotArenaOutputV1 {
  const value = record(JSON.parse(raw), 'J-Bot output');
  if (
    value.schemaVersion !== 1 ||
    !['completed', 'skipped', 'failed'].includes(String(value.status))
  ) {
    throw new Error('Unsupported J-Bot output.');
  }
  const status = value.status as ArenaResultStatus;
  const review = validateReview(value.review);
  let failure: JbotArenaOutputV1['failure'] = null;
  if (value.failure !== null) {
    const item = record(value.failure, 'failure');
    const failureClass = String(item.class);
    if (!['timeout', 'provider', 'parse', 'unknown'].includes(failureClass))
      throw new Error('J-Bot failure class is invalid.');
    failure = {
      class: failureClass as 'timeout' | 'provider' | 'parse' | 'unknown',
      message: string(item.message, 'failure.message'),
    };
    if (Buffer.byteLength(failure.message) > 512 || /[\r\n]/.test(failure.message))
      throw new Error('J-Bot failure message is invalid.');
  }
  validateStatus(status, review, failure);
  return {
    schemaVersion: 1,
    status,
    backend: nullableString(value.backend, 'backend'),
    sdkEngine: nullableString(value.sdkEngine, 'sdkEngine'),
    resolvedModelOptions:
      value.resolvedModelOptions === null
        ? null
        : record(value.resolvedModelOptions, 'resolvedModelOptions'),
    reviewMs: nullableNumber(value.reviewMs, 'reviewMs'),
    usage: validateUsage(value.usage),
    review,
    failure,
  };
}

export function validateArenaResult(
  input: unknown,
  manifest?: ComparisonManifestV1,
): ArenaResultV1 {
  const value = record(input, 'result');
  if (
    value.schemaVersion !== 1 ||
    !['completed', 'skipped', 'failed'].includes(String(value.status))
  ) {
    throw new Error('Unsupported arena result.');
  }
  const status = value.status as ArenaResultStatus;
  const review = validateReview(value.review);
  let failure: ArenaResultV1['failure'] = null;
  if (value.failure !== null) {
    const item = record(value.failure, 'failure');
    const failureClass = string(item.class, 'failure.class') as ArenaFailureClass;
    if (!FAILURE_CLASSES.has(failureClass)) throw new Error('Arena failure class is invalid.');
    failure = {
      class: failureClass,
      message: string(item.message, 'failure.message'),
    };
    if (Buffer.byteLength(failure.message) > 512 || /[\r\n]/.test(failure.message))
      throw new Error('Arena failure message is invalid.');
  }
  validateStatus(status, review, failure);
  const provenance = record(value.provenance, 'provenance');
  const timing = record(value.timing, 'timing');
  const workerMs = nullableNumber(timing.workerMs, 'timing.workerMs');
  if (workerMs === null) throw new Error('timing.workerMs must be a number.');
  const result: ArenaResultV1 = {
    schemaVersion: 1,
    comparisonId: string(value.comparisonId, 'comparisonId'),
    modelIndex: integer(value.modelIndex, 'modelIndex'),
    model: string(value.model, 'model'),
    provider: string(value.provider, 'provider'),
    status,
    provenance: {
      targetBaseSha: string(provenance.targetBaseSha, 'provenance.targetBaseSha'),
      targetHeadSha: string(provenance.targetHeadSha, 'provenance.targetHeadSha'),
      imageRef: string(provenance.imageRef, 'provenance.imageRef'),
      imageDigest: string(provenance.imageDigest, 'provenance.imageDigest'),
      backend: nullableString(provenance.backend, 'provenance.backend'),
      sdkEngine: nullableString(provenance.sdkEngine, 'provenance.sdkEngine'),
      workflowRunId: integer(provenance.workflowRunId, 'provenance.workflowRunId'),
      runAttempt: integer(provenance.runAttempt, 'provenance.runAttempt'),
      reviewConfig: reviewConfig(provenance.reviewConfig, 'provenance.reviewConfig'),
      resolvedModelOptions:
        provenance.resolvedModelOptions === null
          ? null
          : record(provenance.resolvedModelOptions, 'provenance.resolvedModelOptions'),
    },
    timing: {
      reviewMs: nullableNumber(timing.reviewMs, 'timing.reviewMs'),
      workerMs,
    },
    usage: validateUsage(value.usage),
    review,
    failure,
  };
  if (manifest) {
    const model = manifest.models[result.modelIndex];
    if (
      !model ||
      result.comparisonId !== manifest.comparisonId ||
      result.model !== model.model ||
      result.provider !== model.provider ||
      result.provenance.targetBaseSha !== manifest.target.base.sha ||
      result.provenance.targetHeadSha !== manifest.target.head.sha ||
      result.provenance.imageRef !== manifest.jbot.imageRef ||
      result.provenance.imageDigest !== manifest.jbot.imageDigest ||
      result.provenance.workflowRunId !== manifest.arena.workflowRunId ||
      result.provenance.runAttempt !== manifest.arena.runAttempt ||
      JSON.stringify(result.provenance.reviewConfig) !== JSON.stringify(manifest.reviewConfig)
    ) {
      throw new Error('Arena result does not match the comparison manifest.');
    }
  }
  return result;
}

export function sanitizeFailureMessage(error: unknown, secrets: string[] = []): string {
  let message = redactSecrets(error instanceof Error ? error.message : String(error), secrets)
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(
      /\b((?:api[_-]?key|token|secret|password|credential)"?\s*[:=]\s*"?)[^\s,;"}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
    .replace(/\s+/g, ' ')
    .trim();
  if (!message) return 'Unknown arena worker failure.';
  let bounded = '';
  let bytes = 0;
  for (const character of message) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 512) break;
    bounded += character;
    bytes += size;
  }
  return bounded;
}

export function redactSecrets(text: string, secrets: string[]): string {
  for (const secret of [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length)) {
    text = text.replaceAll(secret, '[REDACTED]');
  }
  return text;
}

export function expandSecretsForRedaction(secrets: string[]): string[] {
  const expanded = new Set(secrets.filter(Boolean));
  const isSensitiveKey = (key: string): boolean =>
    /(^|_)(key|token|secret|password|credential|auth|authorization)$/.test(
      key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(),
    );
  const collect = (value: unknown, sensitive = false): void => {
    if (typeof value === 'string') {
      if (sensitive && value.length >= 8) expanded.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item, sensitive);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      collect(item, isSensitiveKey(key));
    }
  };
  for (const secret of secrets) {
    try {
      collect(JSON.parse(secret));
    } catch {
      // Most provider credentials are opaque strings.
    }
  }
  return [...expanded];
}

export function redactSecretsFromValue<T>(value: T, secrets: string[]): T {
  if (typeof value === 'string') return redactSecrets(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactSecretsFromValue(item, secrets)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redactSecrets(key, secrets),
        redactSecretsFromValue(item, secrets),
      ]),
    ) as T;
  }
  return value;
}

export function redactReviewSecrets(
  review: ArenaResultV1['review'],
  secrets: string[],
): ArenaResultV1['review'] {
  if (!review) return null;
  return {
    summary: redactSecrets(review.summary, secrets),
    findings: review.findings.map((finding) => ({
      ...finding,
      path: redactSecrets(finding.path, secrets),
      title: redactSecrets(finding.title, secrets),
      body: redactSecrets(finding.body, secrets),
      ...(finding.evidence === undefined
        ? {}
        : { evidence: redactSecrets(finding.evidence, secrets) }),
    })),
  };
}
