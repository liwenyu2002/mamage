# Face turnaround regression: 2026-10-16

## Cause and Fix

The mixed background benchmark reproduced long face turnaround even though its
24 face handlers consumed only 2.59 seconds in total. The round-robin coordinator
allowed long-running image encoders and vision jobs to refill the shared slots
before a waiting face task. Its actual inference was not the bottleneck.

An idle face lane now takes the next free background slot before normal lane
refill. Remaining lanes retain round-robin scheduling. This does not preempt
running work, add slots, increase face concurrency, or bypass database, memory
and event-loop pressure guards. Empty face queues do not reserve unused capacity.

No changes to face detection, input preparation, model/version, thresholds,
feedback protection, identity matching, upload routes, storage or database schema.
Clustering remains serial under the existing durable coordinator/leader lock.

## Verification

- A regression test first failed on the previous coordinator: a JPEG job refilled
  the next free slot ahead of a queued face. The same test passes after the fix.
- Existing concurrency, pressure, priority, retry and graceful-shutdown tests pass.
- Full server tests pass locally and inside the release image. All seven isolated
  MySQL/workspace integration suites and ten Helm checks pass.
- Same VM, same resource limits, same 24 large JPEG uploads, same initial test
  identity state: face completion **37.149s -> 4.304s** (8.63x turnaround).
- Actual model request hashes and response hashes match for **24/24** calls;
  all eight detected face coordinates, normalized vectors, statuses and canonical
  person assignments match. All 24 derivative JPEG hashes also match.
- Other lanes: semantics **53.515s -> 51.546s**, derivatives **71.773s ->
  67.768s**, similarity **85.857s -> 85.886s**. No background-lane regression.
- Ten simulated uploaders, 30 JPEGs each, **31.0-31.1MB/photo**, about 9.31GB:
  **300/300 successful, 100.494s** (previous 101.903s), plus one smoke upload.
  Ownership, object lengths, signed thumbnails, sampled original hashes and
  idempotent completion verified. During the isolated load, 104 production
  health/desktop probe rounds had no failures; desktop P95 was 376ms.
- All 301 face tasks from this upload test finished before cleanup. Other queued
  work belonging only to disposable test photos was cancelled during cleanup;
  this is not a claim that every 300-photo AI/derivative task was completed.

The throughput fixtures repeat three genuine 24MP scenes; eight face detections
are not an independent recognition-accuracy certification. This is an equivalence
and resource-contention test, supplemented by existing ambiguity, split/merge,
manual correction, embedding-space and large-candidate-library regression tests.
Real identity data is not reclustered or reset by this release.

Production release: Helm revision 20. The guarded update waited for healthy
Service endpoints before replacing the previous API. Its cold-start database
connection was refused once and the container restarted successfully; this was
not a zero-restart release. An independent process probed health and an
authenticated desktop throughout deployment and afterwards: 225 rounds over
180 seconds, zero failures, desktop P95 364ms. A further 31 real production
uploads passed and were precisely cleaned. Protected hashes for 4,724 media,
17,621 faces, 1,790 people, 47 albums and three workspaces remain unchanged.

Private credentials, signed URLs, model outputs, test fixtures and deployment
receipts remain in ignored release directories, not this document. Disposable
test databases/accounts and all scoped storage objects are removed after testing.
