# Batch Video Downloads

## Scope

Replace bursts of individual video downloads with capability-aware folder saving,
falling back to a single native streaming ZIP. The current intranet HTTP entry
uses ZIP; no HTTPS, certificate, model, schema or storage configuration was changed.

The new path applies to all-video selections in albums and the transfer station.
Single-file, photo and mixed-media selections retain their previous behavior.
Public shares still cannot perform bulk downloads.

## Behavior

- Secure contexts with File System Access support invoke the directory picker
  within the click gesture, then stream two files concurrently into a new,
  uniquely named subdirectory. No complete video Blob is retained in page memory.
- Failed items get fresh source URLs and a bounded retry, with an authorized
  same-origin fallback for CORS and mixed-content restrictions. Manual retry
  skips saved items. Cancel removes only this task's incomplete output.
- Unsupported contexts authorize metadata, obtain a short-lived one-use ticket,
  then hand one download to the browser. The page reports handoff, not completion.
- ZIP opens the first source and starts STORE/ZIP64 output without a complete
  HEAD pass, disk staging, re-encoding, or a temporary object-storage archive.
- Upstream reads respect downstream backpressure. Client departure, missing or
  truncated objects and upstream inactivity close the relevant streams.
- Limits: two active ZIP streams per API process, up to 1,000 selected IDs and
  100 GiB per source. These do not change existing upload limits or permissions.
- ZIP interruption generally requires restarting the browser download. Folder
  jobs survive SPA navigation but not a page reload; an unload warning is shown.

## Verification

- Full tests passed in the replacement API image; 8 video tests include denied
  access, unsafe input, STORE/ZIP64, cancellation, late responses, upstream
  failures, concurrency and a source exceeding 5 GiB.
- A synthetic 6,442,451,067-byte source ran in an isolated 1 CPU / 1.5 GiB
  container: first byte 24 ms, duration 37.0 s, peak process RSS 162,639,872 bytes.
  This is not object-storage or campus-network throughput measurement.
- Nine frontend queue tests passed, including byte integrity, concurrency,
  cancellation, incomplete files, quota failure and selective retry.
- Four bundled-browser cases passed: folder and HTTP ZIP modes at desktop and
  phone widths. Tests verify one actual ZIP request, received attachment bytes,
  panel bounds, compact icons and absence of application exceptions.
- Four existing scoped-search cases passed across both workspace styles and
  both viewport sizes. A screenshot-detected icon-sizing issue was fixed and
  locked down with a layout assertion before deployment.
- Production read-only smoke: two existing video originals, a 37,549,859-byte
  ZIP, first byte 2,077 ms, valid CRCs, STORE entries, ZIP64 and matching SHA256s.
  Anonymous access, cross-workspace access and ticket replay were denied.
- Public bulk download remained denied. After cancellation, image Range reads
  remained healthy, at most 51 ms in the two sampled requests. No storage writes
  occurred. Protected folder/album/media/person data fingerprints were unchanged.
- API, web and database were Ready with zero restarts at final inspection; no
  storage connection-pool exhaustion warnings were found in the inspected logs.

## Deployment

Helm revisions 26 (API) and 27 (web), following revision 25. Only feature-specific
files were overlaid onto the verified production images, preserving prior media
proxy, scoped-search and upload fixes. Temporary guard Pods maintained ready
service endpoints during replacement; they were removed afterward.

No commit or push was performed. Private build logs, source hashes, exact image
digests, deployment receipts and verification results remain outside versioned
documentation. Previous images and revision 25 are retained for code rollback;
the database must not be restored to roll back this release.
