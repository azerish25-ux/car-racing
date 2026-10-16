import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DeliveryRun {
  id: number;
  path: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  run_attempt?: number;
  created_at: string;
}
export interface DeliveryArtifact {
  name: string;
  expired: boolean;
}

/** Git acceptance, CI and publication are separate states. Neither a red check
 * nor an absent push-triggered run proves that Git rejected a commit. */
export function classifyDelivery(
  source: 'at-main-head' | 'included-in-newer-main' | 'not-on-main',
  sha: string,
  runs: DeliveryRun[],
  artifacts: DeliveryArtifact[] | null,
) {
  const run = runs
    .filter((r) => r.head_sha === sha && r.path === '.github/workflows/ci.yml')
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) ||
        b.id - a.id ||
        (b.run_attempt ?? 1) - (a.run_attempt ?? 1),
    )[0];
  const validation = !run
    ? 'not-triggered'
    : run.status !== 'completed'
      ? 'running'
      : run.conclusion === 'success'
        ? 'passed'
        : 'failed';
  const release =
    validation !== 'passed'
      ? 'blocked-by-validation'
      : artifacts === null
        ? 'not-inspected'
        : artifacts.some((a) => a.name === 'apex-formula-release' && !a.expired)
          ? 'release-artifact-present'
          : 'no-current-release-artifact';
  return {
    source,
    sha,
    validation,
    runId: run?.id ?? null,
    publication: release,
    // A release artifact is not proof that a CDN deployment is live.
    liveDeployment: 'not-verified',
  };
}

/** Fixed explanations avoid echoing tokens or credentials from remote errors. */
export function transportFailure(error: unknown): string {
  const parts: string[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const item = current as { message?: unknown; code?: unknown; cause?: unknown };
    parts.push(String(item.message ?? ''), String(item.code ?? ''));
    current = item.cause;
  }
  const text = parts.join(' ');
  if (/ENOTFOUND|EAI_AGAIN|Could not resolve host/i.test(text))
    return 'DNS resolution failed before GitHub was reached. Do not retry a push; repair the permitted transport or use the authorized GitHub connector.';
  if (/401|403|authentication|permission denied/i.test(text))
    return 'GitHub access was denied. Verify the intended account and repository permissions; do not print or copy credentials.';
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(text))
    return 'The transport did not complete. Read the remote branch head through a working authorized route before deciding whether any write needs retrying.';
  return 'Delivery verification failed. No push or remote mutation was attempted.';
}

/** Read-only, no retries, no automatic push. Requires an explicit audited SHA. */
export async function deliveryStatus(sha: string, repository = 'cheshmakzanoon-ops/Experiment-3') {
  if (!/^[a-f0-9]{40}$/.test(sha) || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw new Error(
      'Usage: node --experimental-transform-types scripts/delivery-status.ts <40-character-sha> [owner/repository]',
    );
  async function get<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    // Optional existing environment credential; never discover or print secrets.
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    return (await response.json()) as T;
  }
  const ref = await get<{ object: { sha: string } }>('git/ref/heads/main');
  let source: 'at-main-head' | 'included-in-newer-main' | 'not-on-main' = 'at-main-head';
  if (ref.object.sha !== sha) {
    const comparison = await get<{ status: string }>(`compare/${sha}...${ref.object.sha}`);
    source =
      comparison.status === 'ahead' || comparison.status === 'identical'
        ? 'included-in-newer-main'
        : 'not-on-main';
  }
  const runs: DeliveryRun[] = [];
  for (let page = 1; ; page++) {
    const batch = await get<{ total_count: number; workflow_runs: DeliveryRun[] }>(
      `actions/runs?head_sha=${sha}&per_page=100&page=${page}`,
    );
    runs.push(...batch.workflow_runs);
    if (runs.length >= batch.total_count) break;
    if (batch.workflow_runs.length === 0) throw new Error('Incomplete workflow run listing');
    // Fail explicitly rather than claiming completeness after an API search cap.
    if (page >= 10) throw new Error('Workflow run listing exceeds verification limit');
  }
  const preliminary = classifyDelivery(source, sha, runs, null);
  let artifacts: DeliveryArtifact[] | null = null;
  if (preliminary.validation === 'passed' && preliminary.runId !== null) {
    artifacts = [];
    for (let page = 1; ; page++) {
      const batch = await get<{ total_count: number; artifacts: DeliveryArtifact[] }>(
        `actions/runs/${preliminary.runId}/artifacts?per_page=100&page=${page}`,
      );
      artifacts.push(...batch.artifacts);
      if (artifacts.length >= batch.total_count) break;
      if (batch.artifacts.length === 0) throw new Error('Incomplete artifact listing');
      if (page >= 10) throw new Error('Artifact listing exceeds verification limit');
    }
  }
  return classifyDelivery(source, sha, runs, artifacts);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await deliveryStatus(process.argv[2] ?? '', process.argv[3]);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode =
      report.source === 'not-on-main' || report.validation === 'failed'
        ? 1
        : report.validation === 'passed' && report.publication === 'release-artifact-present'
          ? 0
          : 2;
  } catch (error) {
    console.error(transportFailure(error));
    process.exitCode = 2;
  }
}
