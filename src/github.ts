export async function githubRequest<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${path}: ${body}`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export interface GitHubPullRequest {
  html_url: string;
  number: number;
  title: string;
  body: string | null;
  base: {
    ref: string;
    sha: string;
    repo: { full_name: string; clone_url: string; private: boolean };
  };
  head: {
    ref: string;
    sha: string;
    repo: { full_name: string; clone_url: string; private: boolean } | null;
  };
}

export async function getPublicPullRequest(
  owner: string,
  repo: string,
  number: number,
  token: string,
): Promise<GitHubPullRequest> {
  const pull = await githubRequest<GitHubPullRequest>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`,
    token,
  );
  if (pull.base.repo.private || !pull.head.repo || pull.head.repo.private) {
    throw new Error(
      'Arena v1 accepts only public target pull requests with an available head repository.',
    );
  }
  return pull;
}
