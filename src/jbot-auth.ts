import { execFileSync } from 'node:child_process';

export interface JbotAuthRouteV1 {
  schemaVersion: 1;
  model: string;
  provider: string;
  credentialAlias: string;
  fallbackCredentialAlias: string;
  baseUrlAlias: string;
}

const ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

function alias(value: unknown, label: string, optional = false): string {
  if (optional && value === '') return '';
  if (typeof value !== 'string' || !ALIAS_PATTERN.test(value))
    throw new Error(`${label} is invalid.`);
  return value;
}

export function parseJbotAuthRoutes(raw: string, models: string[]): JbotAuthRouteV1[] {
  if (Buffer.byteLength(raw) > 64 * 1024)
    throw new Error('J-Bot auth routing output is too large.');
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.length !== models.length)
    throw new Error('J-Bot auth routing output does not match the requested models.');
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      throw new Error(`J-Bot auth route ${index} is invalid.`);
    const route = candidate as Record<string, unknown>;
    const model = models[index]!;
    const provider = model.slice(0, model.indexOf('/'));
    const credentialAlias = alias(route.credentialAlias, `J-Bot auth route ${index} credential`);
    const fallbackCredentialAlias = alias(
      route.fallbackCredentialAlias,
      `J-Bot auth route ${index} fallback credential`,
      true,
    );
    if (
      route.schemaVersion !== 1 ||
      route.model !== model ||
      route.provider !== provider ||
      fallbackCredentialAlias === credentialAlias
    ) {
      throw new Error(`J-Bot auth route ${index} is inconsistent.`);
    }
    return {
      schemaVersion: 1,
      model,
      provider,
      credentialAlias,
      fallbackCredentialAlias,
      baseUrlAlias: alias(route.baseUrlAlias, `J-Bot auth route ${index} base URL`, true),
    };
  });
}

export function resolveJbotAuthRoutes(image: string, models: string[]): JbotAuthRouteV1[] {
  const raw = execFileSync(
    'docker',
    ['run', '--rm', '--entrypoint', 'node', image, '/app/dist/local/arena-auth.js', ...models],
    { encoding: 'utf8', stdio: 'pipe', timeout: 30_000, maxBuffer: 64 * 1024 },
  );
  return parseJbotAuthRoutes(raw, models);
}
