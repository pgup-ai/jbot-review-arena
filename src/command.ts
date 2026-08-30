const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}\/[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/;
const TARGET_PATTERN =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)$/;
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

export interface CompareCommand {
  target: { url: string; owner: string; repository: string; prNumber: number };
  models: string[];
}

export function parseCompareCommand(body: string): CompareCommand {
  const firstLine = body.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const match = /^\/compare\s+(\S+)\s+--models=(\S+)$/.exec(firstLine);
  if (!match) {
    throw new Error(
      'Expected `/compare https://github.com/OWNER/REPO/pull/123 --models=provider/model,...` on the first line.',
    );
  }
  const [, targetUrl, modelList] = match;
  const target = TARGET_PATTERN.exec(targetUrl!);
  if (!target) throw new Error('Target must be an exact public github.com pull-request URL.');
  const models = modelList!.split(',');
  if (models.length < 1 || models.length > 8) throw new Error('Choose between 1 and 8 models.');
  if (new Set(models).size !== models.length) throw new Error('Models must be unique.');
  for (const model of models) {
    if (model.length < 3 || model.length > 512 || !MODEL_PATTERN.test(model)) {
      throw new Error(`Invalid model ID: ${model}`);
    }
  }
  return {
    target: {
      url: targetUrl!,
      owner: target[1]!,
      repository: target[2]!,
      prNumber: Number(target[3]),
    },
    models,
  };
}

export function assertAuthorizedArenaComment(event: unknown): void {
  if (!event || typeof event !== 'object') throw new Error('Missing issue_comment event.');
  const value = event as Record<string, unknown>;
  const action = value.action;
  const issue = value.issue as Record<string, unknown> | undefined;
  const comment = value.comment as Record<string, unknown> | undefined;
  if (action !== 'created' || !issue?.pull_request) {
    throw new Error('The command must be a newly created comment on an arena pull request.');
  }
  if (!TRUSTED_ASSOCIATIONS.has(String(comment?.author_association ?? ''))) {
    throw new Error('Only arena owners, members, and collaborators can run comparisons.');
  }
}
