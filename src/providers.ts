export interface ArenaProvider {
  credentialAlias: string;
}

export const ARENA_PROVIDERS = {
  openrouter: { credentialAlias: 'OPENROUTER_API_KEY' },
  nvidia: { credentialAlias: 'NVIDIA_API_KEY' },
} as const satisfies Record<string, ArenaProvider>;

export function arenaProvider(provider: string): ArenaProvider | undefined {
  return ARENA_PROVIDERS[provider as keyof typeof ARENA_PROVIDERS];
}
