# Preserved gate before stationary effort accounting

This uninstrumented original `npm run test:offroad` exited **1** after the thermal, committed-landing, collision-derivative and heading-abort corrections. All 20 jump calibrations, three starts, all crash bounds and all 74 entrant classifications passed. The two remaining failures were continuous stops: wet Valley Moto 2 rider 4 at 23.44 seconds and six-lap Arena Nord rider 7 at 22.56 seconds, above the unchanged 20-second limit.

[The original race report](./offroad-races.json), [calibration report](./offroad-calibration.json), [14 source fingerprints](./source-hashes.json) and [post-run integrity record](./post-run-integrity.json) are retained unchanged. The integrity record describes this historical run; it is not a current-source claim after the later AI effort-accounting correction.

The concrete wet-race diagnosis and four production-controller regressions are in [recovery-effort-regression.json](../recovery-effort-regression.json). The successful full-gate result retained in [final-regression.json](../final-regression.json) includes its own working directory and source fingerprints; this historical failure record does not replace it.
