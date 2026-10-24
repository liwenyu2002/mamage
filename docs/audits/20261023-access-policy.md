# Unified Workspace Access Policy

Status: deployed and verified on 2026-10-23, production release 55.

## Public Identities

| Identity | Visible name | Resource scope |
| --- | --- | --- |
| `organization_admin` | 学院管理员 | Current organization, including its groups |
| `manager` | 小组管理员 | Current group |
| `contributor` | 协作者 | Upload and create; edit own albums, folders and media; delete own media only |
| `viewer` | 访客 | View and download authorized content; no writes |

The compatibility `users.role` field is not a group administrator grant.
An account whose old role is `admin` can still be an ordinary contributor in a
group. The same policy produces the account display and route-level mutation
eligibility. Resource ownership and organization/group isolation are checked
separately at each protected resource.

Contributors cannot delete albums or folders, including their own. Metadata
without a recorded creator remains administrator-only. Explicit collaboration
shares retain their resource-scoped editing grants for existing collaborators;
they do not grant deletion of other uploaders' media or ownership of the source
folder tree. Private copies and revoked/expired shares remain isolated.

Only organization administrators can appoint or demote group administrators.
Group administrators can add contributors/viewers within their group, but cannot
change another administrator or grant person capabilities.

## Person Capabilities

These are explicit organization-scoped grants, independent of the four identities:

| Grant | Allowed operations |
| --- | --- |
| Search | Read authorized people/faces and use person search |
| Maintenance | With Search: detect, name, merge, split and maintain person records |

New grants default to Search only. Maintenance requires an explicit boolean.
Disabling Maintenance keeps Search; revoking Search removes both. Routes enforce
these checks even if a client forges roles or calls mutation endpoints directly.
Capability changes take effect on subsequent requests, without requiring a new
login token. The UI rolls back a rejected change to the actual server state.

All five previously approved explicit campus grants retain both capabilities.
Organizations without groups use the same explicit checks; the migration records
their previous administrator/photographer capabilities rather than relying on an
implicit legacy bypass. It does not move or delete any albums, photos or folders.

## Migration And Release

`20261023_001_access_policy.sql` adds `can_manage`, preserves existing grants, and
normalizes the deprecated `member` membership to `editor`. `member` remains an
accepted compatibility input; new assignments use contributor (`editor`), viewer
or manager. The new column defaults to zero. An interrupted DDL step can be retried.

Release order is required: back up affected authorization tables, run the normal
migration runner, roll out and verify the entire API, then publish the web UI.
Do not serve the new UI against old API replicas: the old API cannot enforce
search-only grants. The migration runner records applied filenames; do not replay
the raw backfill SQL after users have started changing capabilities.

Do not roll back to an API that ignores `can_manage` after search-only grants have
been issued. A rollback must retain these authorization checks. The compatibility
system-role controls remain an advanced, permission-gated system function, not a
second role selector for ordinary group users.

## Verification

- Full server `npm test` and web `test:audit` passed; the production web build passed.
- Twelve dedicated policy/route tests cover ownership scope, read-only viewers,
  direct-call denial, grants, cross-organization targets and manager restrictions.
- An isolated MySQL database cloned 54 table schemas, no media or business data.
  Sixty anonymous account profiles were replayed through the real `/users/me`
  handler; all five existing grants retained both capabilities.
- Interrupted-DDL recovery, already-applied migration replay, new-grant defaults,
  independent toggles and immediate revocation passed against MySQL.
- All six existing workspace database integration scripts passed, including
  public sharing, copying, media authorization and private video asset isolation.
- Eight browser cases covered all four identities at 1440px and 390px, including
  denied-write rollback, existing-grant preservation and no horizontal overflow.
- Existing folder-sharing, shared-album, scoped-search and media-viewer browser
  suites passed against the new build.

The existing opt-in over-5GiB ZIP test remains skipped by the normal test command;
this permission change does not claim a new large-download stress result.

## Production Verification

Affected authorization tables were backed up before applying the migration.
The API was fully replaced and verified before publishing the new web interface;
no old API replicas remain in service. Configuration and signing keys were not
changed, and the database pod was not restarted.

All 60 live account profiles matched the intended policy, including the five
existing campus grants. Safe negative checks confirmed unauthorized requests are
rejected; no real albums, people or permissions were mutated by those checks.
Existing collaborative and read-only shares retained their respective access.
Album/photo totals and every stored folder state matched the pre-migration
snapshot. Four read-only browser checks covered administrator and contributor
accounts at desktop and mobile widths without horizontal overflow or client
errors. Temporary release pods were removed.

The rehearsal database and its temporary account were removed separately.
Private authorization backups, account verification results and screenshots are
kept outside version control; no account credentials are included in this report.
