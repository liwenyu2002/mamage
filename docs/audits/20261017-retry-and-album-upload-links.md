# Delayed analysis retries and album upload links

## Durable Retries

Transient failures in photo semantics/descriptions, person observations, face
processing, derivatives and similarity encoding now use bounded delayed retries.
After failed attempts 1-6, the base delays are 15s, 1m, 5m, 15m, 1h and 6h;
up to 20% positive jitter avoids synchronized retry bursts. Attempt seven is
terminal. HTTP 429 Retry-After seconds are respected, capped at six hours.
Authentication, configuration, missing/corrupt input and database-schema
errors stop without futile repeats. Unclassified errors and other task kinds
retain a conservative three-attempt limit.

Retries remain queued in MySQL with future available_at, occupy no running slot,
and survive restarts. Existing priorities, face serial execution, foreground DB
reservation and resource guards are unchanged. Work cancelled during execution
cannot be resurrected by failure handling.

Migration 20261017_001_runtime_task_failures.sql adds one independent history
table without altering existing media or task tables. Retry status and each
failure record commit atomically. History retains task/photo IDs, attempt,
stage, safe outer/root error codes, provider, HTTP status, bounded output-failure
reason and next retry time. It survives later success and normal seven-day task
cleanup, with its own 30-day retention. No foreign key deliberately couples
history lifetime to task/photo lifetime. Headers, keys, signed URLs, raw messages
and model responses are never written to these diagnostics.

Caption generation, source decoding and review failures are distinguished.
Person generation/review also preserve their underlying errors. Semantic workers
propagate durable failures rather than incorrectly completing a failed task;
unreviewed details do not become published results. Source HEAD requests have a
15-second deadline instead of potentially occupying a worker forever.

## Upload Links

Album sharing includes an invitation-upload option. Links contain only validated
numeric album/workspace IDs, never authentication or storage credentials.
Unauthenticated users see login, then the requested album and its upload dialog.
Password-login failure preserves the target. A same-tab, 30-minute numeric-only
intent restores the destination after DingTalk callback; no arbitrary return URL
is accepted. A workspace switch is authorized by the existing backend, not the
link, and only performed for an existing membership. Uploads still enforce all
normal permissions. Opening the link never uploads files or triggers a blocked
automatic system file picker; file selection remains an explicit user action.

The upload action is consumed once and removed from the address bar after
opening. Ordinary refresh does not reopen it. Existing photo deep links and public
view-only shares retain their behavior.

## Verification

- Regression tests reproduce the former three-attempt cutoff and lost review
  error, and now pass with delayed recovery and sanitized diagnostics.
- Real isolated MySQL test: three failures, stop/restart while delayed, recover
  on attempt four, one effect and all three failure records preserved.
- Full server tests, seven isolated workspace/MySQL suites and ten Helm checks.
- Twelve full-page desktop/mobile scenarios: login, failed-password retry,
  authenticated access, missing upload permission, allowed/denied workspace
  switching and OAuth restoration; also staged file selection, invitation link
  display, refresh consumption, JS-error and horizontal-overflow checks.
- Frontend audit, link-validation/storage tests and production builds.

## Deployment Verification

Production revision 21 passed four real read-only browser cases and a scoped
31-photo upload smoke test (approximately 31MB per photo). All uploads and their
face jobs completed. Other test-only background work was cancelled during
precise test cleanup; this does not claim all derivative and AI jobs completed.
No test accounts or objects remain. Protected production data hashes match the
pre-deployment baseline.

One health request timed out during the deployment observation; the corresponding
desktop request succeeded and API/web pods did not restart. The exact cause is
not established. A separate post-deployment observation then passed 229 rounds
over 180 seconds with no failures; desktop-read P95 was approximately 283ms.
Private receipts retain both observations without suppressing the failed sample.

This change does not rescore or recluster existing media and does not modify
model inputs, thresholds or review prompts.
