# Media Proxy Recovery

Verified on 2026-10-17 at 22:18 Asia/Shanghai. Production Helm release `school`,
namespace `mamage`, revision 25. Only the API image changed; web stays at revision
24's image. No schema, credentials, bucket configuration or media records changed.

## Observed Failure

- The website and health endpoint responded, but browser images stayed pending.
- Two identical thumbnail samples timed out through the website at 8 seconds.
  Fresh signed storage reads of those same objects took 13 and 55 ms.
- The API logged an exhausted 50-socket storage pool and more than 260 queued
  requests. The sampled signed image URLs were not expired.

## Reproduced Cause

The proxy registered its response-close listener only after awaiting S3 headers.
If a browser left during that wait, the close event was missed. A late storage
response could then be piped into an already-closed response without consuming
or destroying its body, retaining its storage connection lease.

The real Express route regression fails against the previously deployed API
image and passes against the replacement. Increasing the pool size would not
address the leak.

## Fix

- Register cancellation before the storage request; propagate AbortSignal to
  both GET and HEAD operations and destroy any response arriving after departure.
- Bound the wait for storage headers to 15 seconds and transfer inactivity to
  60 seconds. These are not total video-duration limits; ongoing transfers reset
  the inactivity timer.
- Clear listeners and timers on completion, departure and failure.
- Preserve authorization, private caching, conditional reads, HEAD and Range.
- Add `test:media-proxy` to the existing audit test chain.

## Verification

- Seven regression tests pass, including 55 sequential pre-header departures,
  departure after headers, header timeout, idle timeout, HEAD/Range, unauthorized
  access and missing objects. The old image fails the late-response regression.
- Complete `npm test` passes inside the fixed production image.
- The original two website reads now return 206 with 65,536 bytes in 68 and 17 ms.
- A subsequent check performed 56 successful Range reads, up to four concurrent,
  with a maximum of 57 ms and 12 successful health reads. Of 24 cancellation
  attempts, only one actually aborted because the others finished first; these
  attempts are not described as 24 reproduced cancellations.
- The user's existing production album has 54/54 image elements loaded, including
  all 15 in the viewport; zero pending or broken image elements.
- Current API logs have no renewed storage-pool capacity warnings. All three
  service pods are Ready. The replacement API had one transient MySQL
  `ECONNREFUSED` on startup and recovered automatically; no OOM was observed.

No media, accounts, upload sessions or background jobs were deleted. Existing
multipart upload state remains in the production database. This incident check
did not perform a new large upload or claim long-duration load certification.

## Release Boundary

The image was built from the exact previous production API image with only
`routes/image_proxy.js`, `lib/cos_storage.js`, the new regression and package test
scripts overlaid. Unrelated local work was excluded. Revision 24 and its image
remain available for application rollback; do not restore an old database.

Private baseline probes, test logs, digests, receipts and deployment values are
retained in `.local/media-loading-20261017/` and the matching server deployment
archive. These private artifacts must not be committed or pushed.
