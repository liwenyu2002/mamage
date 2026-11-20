# Personal Workspace and Organization Applications

Status: local implementation and isolated preview. Not deployed.

## Membership Workflow

- An existing IAM-created account with `needsAssignment` enters `/personal`.
- A first-time applicant can select an organization unit or decline. Declining is
  stored per account and never creates a membership. The application dialog can
  be reopened from personal tools or the account page.
- Available organizations expose only active same-school unit names, not their
  member lists, albums, or photos. Existing campus identity fields are preserved.
- A user can have at most five pending applications. Repeated submissions for
  the same unit are idempotent. Pending applications can be withdrawn.
- Unit managers review only their own units. College administrators review their
  school. A verified superadministrator can handle applications across schools.
- Approval of an actual pending application grants only `editor` membership.
  General role assignment and face privileges remain superadministrator-only.
  Existing memberships, higher account roles, and active workspaces are retained.
- Requests cannot be self-approved. Disabled applicants and archived units cannot
  be approved. Permission revocations are rechecked inside the transaction.
- Membership, request state, and the access audit commit or roll back together.

## Notifications

The existing account avatar receives a red dot for pending reviews or unread
application results. The account menu leads to existing member management:
superadministrators use UserAccessPanel; managers see their review panel in the
account page and the existing workspace Members tab.

The badge refreshes every 30 seconds while visible, immediately on focus, and
after local application actions. An already-open review list refreshes on the
same schedule and when returning to the page. A pending review is not cleared
just by opening the panel. Applicant read receipts include a review revision so an old receipt
cannot hide a newer decision after reapplication.

## Local Image Tools

1. Original-quality crop, rotation, tone controls, comparison, undo/redo, and
   download, using the existing photo editor worker and geometry implementation.
2. Target-size compression, format conversion, longest-edge resizing, and batch
   ZIP download. A requested byte limit is checked against the actual output.
   If resizing is disallowed and the limit is impossible, export fails clearly.
3. Uncropped figure panels with configurable columns, spacing, canvas width,
   image order, and optional A/B/C labels below the images. Export is PNG.
4. Pixel dimensions and physical-size calculations at a chosen DPI. This is an
   inspection calculation, not metadata rewriting or synthetic detail generation.
5. Multi-image PDF with one image per page, list reordering, A4/A5/Letter or
   image-sized paper, portrait/landscape/automatic orientation, and 0-30 mm
   margins. Preview and export share the same contain-fit calculation.
6. Screenshot rectangles, arrows and text with color/size controls; selection,
   dragging, corner/endpoint resizing, deletion, and per-image undo/redo.
   Solid black/white privacy masks use the same source-coordinate geometry.

## Annotation and Privacy Invariants

Annotations are attached to normalized source coordinates, not scaled preview
coordinates. Later rotation and crop preserve their registration. Every export
path (single image, compressed ZIP, figure panels, PDF) paints annotations onto
the rendered pixels. Masks are fully opaque, above other annotations, and never
use blur or pixelation. Private thumbnails use flattened previews, with no
fallback to an unredacted source while loading or on failure.

PDF generation uses lazy-loaded pdf-lib 1.17.1. Each page embeds only one freshly
flattened raster with a white background. Original files, EXIF/GPS/XMP metadata,
editing histories, optional layers, attachments, text objects and PDF annotation
objects are not embedded. The local working session still permits explicit undo
and original-image comparison; source files remain untouched. Privacy applies
to the exported copies, not deletion of the user's original source files.

PDF batches are capped at 20 pages, 120 million rendered pixels in total, and
80 MB of encoded image data. Annotation history is capped at 30 steps per image,
with at most 100 annotations per image. Cancellation and canvas cleanup apply
to the PDF and annotation paths as well.

## Local Storage

All image bytes remain in the browser. No image, face embedding, or document is
sent to the server, and no media record is created. File references are temporary
object URLs, released on removal and exit. Navigation warns before discarding
the temporary session. Outputs are new copies; source files are not overwritten.
Only the membership workflow contacts the backend.

The local tools accept JPG, PNG, WebP and browser-decodable AVIF, at most 20 files,
40 MB and 24 megapixels each. Exports and collage canvases have explicit size
bounds. Limits intentionally avoid unbounded mobile canvas allocations.
Oversized rotated output canvases are rejected before decoding/rendering the
export, and the same guard prevents those edits in the personal tool controls.

## Audience and Next Candidates

- Students: signup and scholarship photo limits; custom crop and conversion.
- Doctoral students: preserving original figure content while arranging panels,
  adding subfigure labels, and checking effective print resolution.
- Teachers: batch preparation of teaching images and grouped visual materials.

Further candidates, not implemented: document perspective correction and background removal.
These need their own usable editing and verification flows. In particular, no
AI enhancement or content reconstruction should silently alter scientific data.

## Verification and Release

Run `node --test apps/server/scripts/test_workspace_join.js` and
`npm --prefix apps/web run test:personal` after a frontend build. Browser checks
use the real application modules, synthetic images, and a private in-memory
SQLite fixture. They deny external requests and assert that no images upload.
The document browser checks cover desktop and 390/320 px mobile touch gestures,
PNG metadata removal, private thumbnail pixels, masks after crop/rotation,
ZIP/figure-panel consistency, and exact PDF page sizes/order. They inspect PDF
object structure and extract the embedded rasters with Poppler (`pdfimages`),
then render pages with `pdftoppm` for visual verification. Poppler is required
for these browser checks, not for users of the image tools.

The preview command is `npm --prefix apps/web run preview:personal`. Separate
loopback ports isolate student, manager, and superadministrator login storage.
The preview has no production database or IAM credentials.

`test_workspace_join_mysql.cjs` initializes a fresh local mysqld with networking
disabled and its own private socket, applies the migration twice, verifies four
concurrent applications create one request, and two concurrent reviewers commit
one approval. This was verified with local MySQL 9.6.0. It never connects to an
existing database. Set `MAMAGE_TEST_MYSQLD` to another local binary if needed.

Before production release, use the existing managed migration/release procedure
for `20261117_001_workspace_join_requests.sql` and verify against the deployment's
MySQL version. No production schema or deployment was changed in this preview.
