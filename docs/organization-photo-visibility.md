# Organization Photo Visibility

Superadministrators can use **User Access** to change the organization-photo
checkbox for each configurable account. It is an account-level read scope,
layered on top of existing school, workspace, private album and share checks:

- Checked: preserve the existing photo access of that account.
- Unchecked: return only photos and videos whose recorded uploader is that
  account. Albums remain available for uploads; covers and counts are scoped.

The checkbox never grants group membership, administrative privileges or
permission to edit someone else's media. Own-only accounts cannot publish or
copy an entire album or folder, and organization-wide people grants do not
override the photo restriction. Explicit selection/sharing of the account's
own media still uses the existing authorization checks.

Apply the managed migration `20261118_001_organization_photo_visibility.sql`
before deploying the backend. It preserves existing accounts' access and makes
new accounts own-only, including on approval of a join request. Rerunning it
does not change an explicitly configured account. Protected superadministrator
accounts remain outside this editor.

Ordinary signed media proxy URLs recheck the database at delivery. Already
downloaded files, outstanding direct object-storage URLs until expiry, and
previously issued public share links are not retroactively recalled by the
account setting. Publish/revoke public links separately using share management.
