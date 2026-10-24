# Download Error Tabs

## Finding

The original-media download path set cross-origin anchors to `target="_blank"`
and considered handing off a URL a success, without checking whether the signed
URL returned an attachment. An object-storage AccessDenied response could
therefore open an error tab instead of delivering a file. This path remained in
single-video, photo and mixed-media downloads; the newer all-video ZIP path was
not repeatedly creating windows in regression tests.

Fresh signatures for the screenshot's video and two other samples returned valid
Range responses from both the production server and the local test machine.
The existing truncated browser URL could not establish its exact failure reason;
this was not evidence that bucket-wide permissions needed changing.

## Fix

- Original-media downloads now use a shared frontend downloader instead of
  cross-origin `_blank` anchors.
- A five-second bounded, one-byte Range GET checks that a signed GET actually
  returns a successful attachment, not an XML/HTML/JSON error. Its body is
  cancelled without buffering the complete media file.
- Working signed attachments retain direct object-storage downloads. Website
  bearer credentials are never sent to storage.
- Denied, expired, inline, CORS-failed or unavailable direct sources fall back to
  freshly authorized photo metadata and a current same-origin media signature.
  Metadata authorization failures are reported instead of reusing an expired URL.
- Download handoff uses the current browsing context with attachment/download
  semantics, not new tabs. Full videos are not converted into in-memory Blobs.
- Photo tone rendering, all-video folder/ZIP queues and playback are unchanged.

## Verification

- The old production bundle fails the new browser regression: its download
  anchor targets a new storage error tab and no original reaches the downloader
  when the mocked storage response is AccessDenied.
- Six isolated downloader tests passed, covering direct attachments, error
  bodies, CORS/API failures, probe timeout, authorization failure, unsafe fallback
  URLs, cancellation and absence of whole-file buffering.
- Eight bundled-browser cases passed across desktop and phone sizes: individual
  video, mixed selections, photos, successful direct storage and CORS failure.
  All selected test files arrived with correct bytes and zero popup tabs.
- Four existing video folder/ZIP cases, four scoped-search cases and the full
  frontend audit suite passed. Production build and whitespace checks passed.
- Production browser checks used the deployed application bundle and real
  authentication, download APIs and an existing 1,954,660-byte original. Album
  listing metadata and display-only thumbnails were isolated to keep the check
  read-only and small. Both a normal signature and a deliberately invalidated
  signature produced matching original SHA256s, zero popup tabs and no navigation
  away from the album. Observed durations were 210 ms and 291 ms respectively;
  these are two smoke samples, not a throughput benchmark.

## Deployment

Frontend-only Helm revision 28, following revision 27. API, database, credentials,
storage policy and the existing streaming ZIP implementation were not changed.
A temporary ready web Pod protected service endpoints during replacement.
Protected data fingerprints matched before and after deployment. Private build
logs, hashes and receipts remain outside versioned documentation.

Previously opened application tabs must be refreshed to load the updated script.
Already-open storage error tabs are not programmatically closed. Browser-level
"ask where to save each file" preferences are outside this fix.
