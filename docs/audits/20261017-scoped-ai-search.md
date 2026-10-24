# Scoped AI Photo Search

## Behavior

- Album searches stay inside the open album, including searches submitted in the top navigation.
- Folder searches include albums directly assigned to the folder and all nested descendants. Siblings and ancestors are excluded; duplicate album membership is deduplicated.
- Global, album and folder searches use the same intent interpretation, person/garment verification, strict/related matching, streaming and polling pipeline.
- Both glass and classic column layouts show scoped results. Matching album/folder names remain navigable, including empty albums.
- Opening a folder result opens its parent album and the matching photo. Both folder and album results support further pages.
- Clearing the search restores browsing. New queries and navigation cancel old requests and visual polling.

## Authorization

The API accepts `folderId` or `projectId`, not both. A folder is resolved from the authenticated organization's active workspace in `album_desktop_workspaces`; its album IDs are resolved on the server, then intersected with the existing album visibility rules. Client-supplied album lists, organization and unit query parameters cannot expand this range.

Empty folders add a false SQL predicate, not an absent filter. Invalid, deleted, foreign and anonymous folders fail before streaming starts. The scope predicate is retained for visual candidates, counts, batches and explicitly requested related results. Existing face-search grants remain required.

The client also requires the response to acknowledge the exact folder scope. An old server ignoring the new parameter cannot silently display a global result list.

## Verification

- Full API image `npm test` and web audit suite passed.
- Folder-scope tests cover recursion, deduplication, malformed/cyclic historical state, empty directories, restricted albums, invalid and foreign IDs.
- HTTP route and search contract tests cover authoritative scope, conflicts, malformed album IDs, streaming, related matching and visual candidate boundaries.
- Four browser cases (1440px/390px, glass/classic) cover folder scope, album scope, pagination, target-photo opening, cancellation, empty folders and an old server ignoring scope. No test writes are sent.
- Existing production folder membership was checked read-only before deployment against SQL photo counts.
- Production smoke checks cover an administrator and an ordinary account, including streamed results for all their folders, album range and invalid/anonymous access denial.

## Release

School K3s Helm release `school`, revisions 23 (API) and 24 (web), based on revision 22. The backend was made ready before publishing the new UI. A temporary ready API instance covered the API replacement and was removed afterward.

Production browser validation passed in both layouts at 1440px and 390px with real images, no JavaScript errors and no write requests. Administrator and ordinary-account smoke checks verified ten folder scopes. Availability monitoring made 288 requests: one sampling round (two requests) returned 502 while the web pod was being replaced, before its Ready condition; the next round and all post-ready samples succeeded. This release is not claimed to have been zero-downtime.

No schema, runtime credentials, model configuration, original media, folder membership or access policy changes. Source changes were compared with the deployed baseline and shipped as scoped overlays. Revision 22 remains available for rollback. Private receipts, screenshots and operational details are kept outside Git under `.local/scoped-search-20261017/`.
