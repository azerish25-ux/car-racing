// Authoritative online racing slice (WP50–WP54, masterplan §22). Runs one
// in-memory race server and eight networked clients for 60 s of racing on a
// simulated 100 ms RTT / 2% loss link (with jitter, duplication and
// reordering), cuts one client's link mid-race and reconnects it with its
// token, then verifies the archived record by headless re-simulation and
// checks that a forged lap time is rejected. Writes docs/online-slice.json.
// No real network is involved; see docs/production/ONLINE_SLICE.md.
import { writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { recordDigest, verifyRecord, type SessionRecord } from '../src/net/records.ts';
import { runOnlineSlice } from '../src/net/slice.ts';
import { TARGET_LINK } from '../src/net/transport.ts';

const RACE_SECONDS = Number(process.argv[2] ?? 60),
  CLIENTS = 8,
  started = performance.now();
const { report, server } = runOnlineSlice({
  clients: CLIENTS,
  seed: 2026,
  raceSeconds: RACE_SECONDS,
  link: TARGET_LINK,
  disconnect: { client: 5, atSeconds: 20, offlineSeconds: 3 },
  progress: (message) => console.log(`[online-slice] ${message}`),
});

// A forged claim: one lap 0.5 s faster, digest recomputed so only the
// re-simulation can catch it.
let forged: { attempted: boolean; rejected: boolean; reason: string } = {
  attempted: false,
  rejected: false,
  reason: 'no completed lap to forge',
};
const record = server.record as SessionRecord;
const car = record.claim.lapTimes.findIndex((laps) => laps.length > 0);
if (car >= 0) {
  console.log('[online-slice] verifying a forged copy (one lap 0.5 s faster)');
  const copy = JSON.parse(JSON.stringify(record)) as SessionRecord;
  copy.claim.lapTimes[car][0] -= 0.5;
  copy.claim.best[car] = copy.claim.lapTimes[car][0];
  copy.digest = recordDigest(copy);
  const result = verifyRecord(copy);
  forged = {
    attempted: true,
    rejected: !result.ok,
    reason: result.ok ? 'accepted' : result.reason,
  };
}

const human = report.resilience.disconnect;
const checks = {
  recordVerified: report.verification?.ok === true,
  forgedLapTimeRejected: forged.attempted && forged.rejected,
  noProgressDisputes: report.progressDisputes.length === 0,
  rejoinRestoredControl: human !== null && human.humanAgainAfterMs !== null,
  takeoverWithinTimeout:
    human !== null && human.takeoverAfterMs !== null && human.takeoverAfterMs <= 1100,
  predictionCleanP95BelowHalfMetre: report.prediction.positionErrorCleanM.p95 < 0.5,
  downlinkBelow100Kbit: report.bandwidth.perClientDownWireKbit.max < 100,
  noRejectedInputs: report.inputs.rejected === 0,
};
const output = {
  ...report,
  forgedRecord: forged,
  checks,
  wallSeconds: Math.round((performance.now() - started) / 100) / 10,
  runtime: `node ${process.version}`,
  // Server tick timings are wall-clock on this host; a loaded host inflates them.
  host: { cpus: cpus().length, loadAverage1m: Math.round(loadavg()[0] * 100) / 100 },
  note: 'In-memory transport and simulated network; server tick timings are this machine, not reference hardware. Bot drivers are AI pilots whose commands cross the simulated network (see ONLINE_SLICE.md).',
};
writeFileSync('docs/online-slice.json', JSON.stringify(output, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      bandwidthDownKbit: report.bandwidth.perClientDownWireKbit.mean,
      bandwidthUpKbit: report.bandwidth.perClientUpWireKbit.mean,
      predictionCleanM: report.prediction.positionErrorCleanM,
      correctionM: report.prediction.correctionM,
      remoteErrorM: report.interpolation.positionErrorM,
      verification: report.verification?.ok,
      forged,
      checks,
    },
    null,
    2,
  ),
);
const failed = Object.entries(checks)
  .filter(([, ok]) => !ok)
  .map(([name]) => name);
if (failed.length) {
  console.error(`[online-slice] FAILED: ${failed.join(', ')}`);
  process.exitCode = 1;
}
