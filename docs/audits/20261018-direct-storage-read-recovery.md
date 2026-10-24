# Direct Storage Read Recovery

## Findings

- Valid signed GETs and browser-visible attachment headers worked for all three
  production samples. Configured CORS already included the current site origin.
- A genuinely expired signature returned 403 without an allow-origin header;
  browser fetch surfaced a generic TypeError. Refreshing the signature restored
  a valid 206 response. The expiry test accounted for an observed 24-second
  signer/storage clock offset and waited 88 seconds for a 60-second signature.
  Host clocks were not changed.
- The gateway rejected GET/Range OPTIONS preflight with 400 InvalidArgument,
  despite matching CORS rules. Current Chromium's simple and Range GETs worked.
  This is a gateway compatibility boundary, not evidence that the bucket should
  become public. No bucket CORS rules or access policy were changed.
- Signing APIs lacked no-store headers, while signed download responses
  inherited public, one-year immutable cache metadata from the original object.
- Client eligibility failures were cached for the page lifetime. Signed-link
  caching ignored signing-request latency, inflated short lifetimes, did not
  support forced refresh, and was not scoped to account changes. New regression
  tests failed on each of these old behaviors before the fixes.

## Changes

- Signing and eligibility responses are private/no-store and vary by
  Authorization. Client API requests bypass HTTP caches and have a deadline.
- Attachment signatures override response caching to private/no-store. Preview
  behavior, object metadata and existing 60/900-second lifetimes are unchanged.
- Eligibility failures can recover; positive results are briefly cached.
  Signature validity includes signing latency and retains a safety margin.
  Account/workspace changes clear capabilities, late old-session responses are
  discarded, and simultaneous requests for the same file share one signing call.
- Failed attachment probes refresh a signature once before proxy fallback.
  Range-specific network/CORS failures can use a simple GET attachment probe;
  the response body is immediately cancelled, never buffered as a whole video.
  Missing attachment/error responses still fail closed. Timeouts do not produce
  an unbounded retry loop. Website bearer credentials are never sent to storage.
- Directory-download retries try a fresh storage source before the authorized
  proxy. Cancellation, two-worker limits and cleanup of partial output remain.
- Native handoffs still target the current context, not new windows. Rendering,
  playback, private access checks and streaming ZIP behavior are preserved.

## Verification And Release

- Full replacement API image tests and full frontend audit passed.
- Two server cache-policy tests, nine direct-client tests, eight attachment
  tests and ten directory-queue tests passed. Eleven media browser cases,
  four folder/ZIP cases and four scoped-search cases passed across both sizes.
- Deployed production bundle, real authentication/APIs and a 1,954,660-byte
  existing original were checked with only listing/display-thumbnail fixtures:
  normal, first-signature failure and Range-unavailable cases all downloaded
  directly from the storage origin. Persistent direct denial used the proxy.
  All four files matched original SHA256s; zero popup tabs or app navigation.
  Observed times were 242/215/228/208 ms, not a throughput benchmark.
- Three source probes confirmed private/no-store, valid attachments and
  unchanged 60/900-second TTLs. Unsigned reads remained denied (404).
  CORS rules and protected-data fingerprints matched their prior snapshots.
- Helm revisions 29 (API) and 30 (web), following 28; temporary ready Pods
  protected endpoints during replacement. No schema/config/model/credential
  changes or object-storage writes. Prior images and receipts are retained.

The gateway's general OPTIONS handling is not repaired by this application
release; download validation avoids depending on it where possible. A real
network failure or persistent CORS/authentication denial still uses the proxy.
HTTP bulk streaming ZIP continues to pass through the server for packaging.
Existing application tabs need a refresh to load the updated code. No Git
commit or push was performed; exact digests and private logs are archived locally.
