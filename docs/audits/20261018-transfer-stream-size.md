# Transfer Station Streaming Downloads

## Scope

- New transfer-station downloads use one native streaming ZIP for photos and
  mixed selections, rather than preparing/uploading an archive first. Existing
  prepared jobs can still be resumed or cancelled. Public-share restrictions
  and photo-adjustment rendering are unchanged.
- Compatible secure browsers retain the video directory-saving path. HTTP
  continues to use the browser's native downloader without opening new tabs.
- Video names include the album, optional timeline section, meaningful title
  and unique photo ID, preserving the original extension. Names are sanitized
  and UTF-8 bounded. Video ZIPs have a recognizable archive name and matching
  root directory; this does not reconstruct unrecorded camera filenames.

## Size And Resource Safety

- Authenticated summaries inspect only authorized object metadata, not original
  bodies. HEAD work is globally limited to four per API process, with per-read
  cancellation deadlines, a short request budget, bounded caching and explicit
  unknown-size counts. Partial sums are not labelled as complete totals.
- The download panel displays approximate original-media volume and separate
  photo/video counts. Adjusted photos can change size when rendered.
- Video ZIPs use yazl 3.3.1's calculated-size callback with STORE and declared
  file sizes. When all sizes are known, Content-Length is the library's exact
  archive size, not an approximation. Native browsers can calculate progress
  and remaining time. If sizes are missing, the archive streams without a
  fabricated Content-Length.
- Originals open lazily, one at a time, with backpressure, size validation,
  upstream timeouts and disconnect cleanup. No complete server-side ZIP is
  staged on disk or uploaded to storage. ZIP concurrency is limited to two per
  API process across video and mixed/photo paths.
- Dynamically streamed ZIPs still do not support resumable Range requests.
  Browser handoff is not reported as a completed or resumable download.

## Verification

- New naming, metadata, exact-length and partial-estimate tests failed before
  implementation and pass with the changes. Cancellation, truncated objects,
  authorization and concurrency coverage is retained.
- A synthetic 6 GiB original streamed with ZIP64, first data in 26 ms and peak
  process RSS 222822400 bytes. This is an isolated synthetic test, not a school
  network throughput measurement.
- Full API image tests and frontend audit are required before rollout, together
  with desktop/mobile album, folder, transfer-video, mixed and photo cases.
- Production integrity and release receipts are private. Publication status is
  recorded only after real authenticated download checks and rollout succeed.

## Production Release

Helm revisions 31 (API) and 32 (web) were deployed after the full API tests,
frontend audit, ten album/transfer browser cases, eleven original-download
browser cases and four scoped-search cases passed. Two real originals totalled
37549465 bytes; their streamed ZIP was 37550103 bytes, exactly matching its
Content-Length. ZIP integrity and both original SHA256 comparisons passed.
Observed first data arrived in 105 ms for this warm-metadata sample, not a
general speed promise. Real desktop video and mobile mixed transfer workflows
showed sizes and started one native ZIP each with zero popup windows.

Original storage objects and protected database fingerprints were unchanged.
No Git commit or push was performed. Existing tabs need one refresh to load
the new frontend. Previous revision 30 and its images/receipts are retained.

No schema, model, credential, HTTPS, bucket ACL or CORS policy change is needed.

## Mixed Media Follow-Up

Revisions 33 (API) and 34 (web) unify multiple selected photos and videos into
one streaming ZIP in both albums and the transfer station. All entries live in
one root directory, without photo/video subdirectories. Single-file downloads
remain direct. Unmodified storage media use the same lazy ZIP64 writer and
exact Content-Length when sizes are known. Adjusted photos retain their render
path and share the directory with unchanged videos; no video transcoding was
added. Video originals retain the 100 GiB limit in the adjusted-photo fallback.

Full API tests, frontend audit, fourteen batch browser cases, nine single-file
browser cases, and four scoped-search cases passed. Route tests cover both
unmodified and adjusted mixed selections. A real mixed archive contained two
entries, totalled 5149923 bytes, matched Content-Length, passed ZIP validation,
and matched both source SHA256 hashes. Desktop album and mobile transfer flows
each triggered one ZIP with zero popups and a visible size summary.

Protected database fingerprints were unchanged. No storage objects were
modified, and no Git commit or push was performed. Revision 32 remains the
previous release. Dynamic ZIP downloads still do not support resume.
