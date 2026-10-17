# Offroad CI recovery checkpoint

The temporary workspace reset before the follow-up branch publication. This checkpoint restores the exact previously uploaded CI blob (Git SHA `2a01159448fd11302e11b0e7e20267fa36a77154`) and its required-gate contract.

The unchanged complete calibration/race validators now have a separate blocking job, source protection, temporary report output, explicit unfiltered selection, and failure-log retention. No existing publication prerequisite is removed.

The accompanying fresh native report contains **13 passing tests in two files**: four CI contracts and nine source-guard behavior cases. These do not replace the actual offroad race or graphics gates. Runtime reconstruction and fresh visual validation continue separately; earlier local reports lost in the reset are not reconstructed as native evidence.
