# Photo Tone V3

## Scope

This is a non-destructive adjustment pipeline for rendered RGB photos. It is not
Adobe's proprietary process, a RAW developer, or a way to recover already-clipped
source data. Source files are never overwritten. The user explicitly retired the
old looks: v1/v2 and unversioned legacy adjustments normalize to neutral v3. They
are not translated into new slider values. Production records are not modified by
the local preview or test suite.

## Pipeline

`apps/server/lib/photo_tone/engine.mjs` is the shared browser/server processor.
Sharp rotates the original using EXIF and converts its ICC space to sRGB before
creating a lossless working PNG (1280px long edge by default). The browser caches
four decoded sources and renders adjustments in a Worker with one request in
flight, coalescing intermediate slider values. No network request is made for each
slider movement.

Processing order:

1. Decode sRGB to linear light.
2. Apply relative white balance and exposure in EV (`2 ** exposure`).
3. Apply monotonic shadow/highlight luminance curves, retaining floating-point
   highlight headroom until the tone stage completes.
4. Apply contrast and white/black endpoints in perceptual coordinates.
5. Apply saturation/vibrance and compress chroma into the output gamut. Optional
   skin saturation and brightness use a soft source-color mask and highlight
   shoulder, then fit the result into the output gamut.
6. Encode sRGB. Neutral settings preserve decoded working pixels exactly.

White balance sliders are relative adjustments, not invented Kelvin readings for
JPEG files. Reset, comparison, and auto tone always refer to the original working
source; previously adjusted previews are never used as the input.

Skin saturation and brightness range from -100 to 100 and default to zero. They
select a soft range of skin-like warm colors, not a semantic skin segmentation.
Warm wood or other similar colors can also be affected. Brightness preserves
highlight headroom; saturation approaches the gamut boundary smoothly instead of
hard-clipping a channel. These controls do not change saved face records.

## Auto Tone And Comparison

Auto tone reads existing face boxes, without running inference, and meters the
interior of each valid face. Confidence, geometry, duplicate boxes, and source
aspect ratio are checked. Small, uncertain, or incompatible boxes are ignored.
Dim faces receive a modest relative lift rather than a single target brightness
for every skin tone. Global RGB samples and brighter faces limit the exposure
increase and highlight adjustment. The clipping guard is sampled, not a guarantee
for every source pixel or a substitute for local tone mapping.

Without usable face boxes, auto tone falls back to a conservative global histogram
suggestion. A face lookup failure or two-second timeout also falls back; manual
controls do not wait for it. Neither mode forces a normally exposed image down to
a fixed middle gray. Auto resets tonal controls but retains white balance, global
color, and skin settings. Repeated auto clicks do not compound adjustments.

Comparison supports original/adjusted modes, a hold-to-view-original button, and
a draggable left-original/right-adjusted divider. Mouse, touch, and keyboard
controls reuse decoded pixels and do not send render or save requests. The
divider does not trigger photo navigation. Releasing the hold restores the
previous comparison mode, including on cancellation or window blur.

The original authenticated render routes and permission checks are retained.
Working pixels and rendered responses identify `mamage-tone-v3-srgb` in the
`X-MaMage-Tone-Engine` header; the frontend rejects an incompatible backend rather
than quietly displaying or downloading different processing. Both frontend and
backend must therefore be released together. The shared module is included in
the web Docker build context, not duplicated into a second implementation.

## Saving And Downloading

V3 parameters remain in the existing `photos.adjustments` JSON field. Saving
does not modify the source file. Ten editing gestures can be undone/redone;
unsaved drafts survive switching photos within the mounted album viewer.
Downloading while editing uses the current draft. Selecting the persistent
original mode downloads the original file; transient hold and split comparisons
still download the draft, not a comparison collage. Downloading never silently
saves parameters.

Adjusted exports embed an sRGB ICC profile. The existing adjusted-render limit
is still 4096px on the long edge; this is not a full-resolution RAW export.
Original downloads, including ZIP entries for retired adjustments, retain their
original bytes. JPEG compression and output resolution can introduce differences
from a lossless preview; the underlying RGB processor is shared.

## Local Verification

- Server: `npm --prefix apps/server run test:photo-tone`
- Download and ownership regression: `node --test apps/server/scripts/test_video_download.js apps/server/scripts/test_metadata_edit_permissions.js`
- Build: `npm --prefix apps/web run build`
- Browser: `npm --prefix apps/web run test:photo-tone`
- Use a real local photo: set `MAMAGE_TONE_TEST_PHOTO` to its absolute path for the
  browser test. Without it, the fixture uses a generated gradient.
- Interactive preview: `npm --prefix apps/web run preview:photo-tone -- /absolute/photo.jpg`
- Optional second argument: a JSON file containing explicit test face boxes.
  These are local test geometry, not a new detector result or production record.

The preview binds only to loopback (port 5201 by default), uses a fake test
session, serves two fixture photos, and persists edits only in process memory.
It does not proxy requests to production. Browser tests block other origins and
check desktop/mobile layouts, browser/server pixel agreement, source reuse,
comparison with pointer/keyboard/touch input, skin controls, face-metering
integration, undo/redo, save/reopen, export, and legacy reset. Screenshots and
measurements are written to the ignored `.local/tone-qa` directory.
