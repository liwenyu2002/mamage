# Long-Video Upload Load Test and Acknowledgement Race

## Finding and Fix

Five concurrent authenticated upload sessions exposed one real completion failure:
all proxy parts returned success, but complete returned
`409 DIRECT_VIDEO_PARTS_STILL_UPLOADING`. The first run was stopped with 26
committed videos and one failed completion; it was not counted as a pass.

The proxy handler sent its success response before the asynchronous `finally`
block persisted lease removal. An immediate complete request could therefore
observe a stale lease. Successful part acknowledgement now follows the awaited
lease cleanup. Part sizes, ETags, complete validation, ownership and authorization
are unchanged.

The HTTP route regression simulates durable state with copied values and a held
lease-release write. It deterministically fails against the previous production
image and passes against the fixed image. An in-memory shared object alone would
not reproduce the persistence lag. Full server tests in the fixed image passed.
Only the upload route and its test changed; no schema, configuration, frontend,
model or matching-threshold change was made.

## Independent Retest

Production revision 22 used five fresh test identities, ten videos each. One
single-video smoke preceded a five-session run of the remaining 49 videos; the
smoke is not represented as a concurrent upload.

- 50/50 committed, every identity has ten correctly attributed videos.
- Each source is 2,343,988,987 bytes, above 2 GiB, approximately 600.6 seconds,
  H.264/AAC, 1280x720 at 15 fps. A synthetic moving/noisy 20-second segment is
  repeated continuously; beginning, middle and end decode successfully. No
  sparse padding or server-side object copy replaces byte transfer.
- Actual source transfer totals 117.199 GB. The 49-video concurrent phase took
  24.48 minutes, aggregate 78.20 MB/s. There were no part retries or completion
  retries masking the race.
- All parts passed MD5 checks; all 50 committed originals passed immediate
  size/multipart-ETag checks. Forty-six not subsequently remuxed originals passed
  beginning/middle/end range checks; one full SHA256 per identity passed, five
  whole files. Four normal faststart remuxes legitimately change container bytes.
- Repeat complete returned the same media ID. All five album listings contained
  the same 50 media IDs.
- During the concurrent phase, 503 health/desktop rounds had no HTTP failures.
  Desktop-read P95 was 874 ms, maximum 1320 ms. Under load, real desktop/mobile
  browser checks displayed all 15 images in an existing album without script
  errors or horizontal overflow; first-image readiness varied with load.
- API-main RSS peaked at 558 MiB; summed ffmpeg RSS at 472 MiB. Minimum host
  available memory was 4.47 GiB, free disk 40.40 GiB. No OOM kill or additional
  pod restart occurred during the retest.

Deployment cold start had one ECONNREFUSED restart before this retest. A separate
219-round deployment observation recorded no foreground HTTP failures. One scoped
resource sampler queried the intentionally deleted test organization during
cleanup and failed its scope assertion; the raw sample is retained, not counted
as an application HTTP failure or silently discarded.

## Limits and Cleanup

The storage gateway still returned 400 InvalidArgument for OPTIONS preflight;
a real browser reproduced Failed to fetch, while signed PUT itself succeeded
and the current origin was already present in bucket CORS. No bucket permissions
were changed. The tested client path was the existing same-origin multipart
proxy fallback, two 8-MiB parts per identity, not end-to-end browser-direct S3.

Background processing remained enabled. Four transcodes and twelve semantic
jobs completed; remaining queued test-only work was cancelled after uploads.
In-flight work finished before source deletion. This does not claim all 50
videos completed transcoding or analysis.

All 50 test media, six temporary accounts, the isolated album/unit/organization,
upload sessions and original/derived object keys were cleaned. No test objects
remain. Production media, album, folder and person protection hashes match the
baseline; ordinary upload/delete/edit capabilities remain unchanged.

Five sessions originated from one Mac with campus-intranet access sharing a network link, not five
physical devices. These figures do not certify higher concurrency, arbitrary
camera/4K/HEVC transcode performance, or a single 100-GB video workflow. Private
receipts preserve the failed first run, regression evidence and successful retest.
