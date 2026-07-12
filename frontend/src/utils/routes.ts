/**
 * Builds the PR-detail route for a repository + PR number.
 *
 * `repo` (e.g. `owner/repo`) is carried as a query parameter rather than a path
 * segment so its slash never rides inside the path — reverse proxies decode
 * `%2F` back to `/` and break path-segment matching. A query parameter is never
 * path-normalized, so the link works behind any proxy.
 */
export function prDetailPath(repoFullName: string, prNumber: number): string {
  const params = new URLSearchParams({ repo: repoFullName });
  return `/pr/${prNumber}?${params.toString()}`;
}
