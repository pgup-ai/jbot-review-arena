import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseJbotAuthRoutes } from '../src/jbot-auth.ts';

describe('pinned J-Bot auth routing', () => {
  it('accepts ordered provider credentials, fallbacks, and custom base URLs', () => {
    const models = ['cline/cline-free/model', 'grok/default', 'openai-compatible/vendor/model'];
    const routes = [
      {
        schemaVersion: 1,
        model: models[0],
        provider: 'cline',
        credentialAlias: 'CLINE_AUTH_JSON',
        fallbackCredentialAlias: '',
        baseUrlAlias: '',
      },
      {
        schemaVersion: 1,
        model: models[1],
        provider: 'grok',
        credentialAlias: 'GROK_AUTH_JSON',
        fallbackCredentialAlias: 'XAI_API_KEY',
        baseUrlAlias: '',
      },
      {
        schemaVersion: 1,
        model: models[2],
        provider: 'openai-compatible',
        credentialAlias: 'JBOT_OPENAI_COMPATIBLE_API_KEY',
        fallbackCredentialAlias: '',
        baseUrlAlias: 'JBOT_OPENAI_COMPATIBLE_BASE_URL',
      },
    ];
    assert.deepEqual(parseJbotAuthRoutes(JSON.stringify(routes), models), routes);
  });

  it('rejects reordered models and unsafe secret aliases', () => {
    const route = {
      schemaVersion: 1,
      model: 'cline/a',
      provider: 'cline',
      credentialAlias: 'CLINE_AUTH_JSON',
      fallbackCredentialAlias: '',
      baseUrlAlias: '',
    };
    assert.throws(() => parseJbotAuthRoutes(JSON.stringify([route]), ['cline/b']), /inconsistent/);
    assert.throws(
      () =>
        parseJbotAuthRoutes(JSON.stringify([{ ...route, credentialAlias: 'GITHUB_TOKEN;echo' }]), [
          'cline/a',
        ]),
      /credential is invalid/,
    );
  });
});
