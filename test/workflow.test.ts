import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'node:test';

const workflow = readFileSync(resolve('.github/workflows/jbot-compare.yml'), 'utf8');

it('keeps workflow fan-out, failure publication, artifacts, and permissions explicit', () => {
  assert.match(workflow, /issue_comment:\n\s+types: \[created\]/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.prepare\.outputs\.matrix\) \}\}/);
  assert.match(workflow, /publish:\n\s+if: always\(\) && needs\.prepare\.result == 'success'/);
  assert.match(workflow, /name: \$\{\{ matrix\.artifactName \}\}/);
  assert.match(workflow, /MODEL_CREDENTIAL: \$\{\{ secrets\[matrix\.credentialAlias\] \}\}/);
  const reviewJob = workflow.slice(workflow.indexOf('  review:'), workflow.indexOf('  publish:'));
  assert.doesNotMatch(reviewJob, /issues: write/);
  const publishJob = workflow.slice(workflow.indexOf('  publish:'));
  assert.doesNotMatch(publishJob, /MODEL_CREDENTIAL|OPENROUTER_API_KEY|NVIDIA_API_KEY/);
});
