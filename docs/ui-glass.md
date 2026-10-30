# Shared Glass UI

`apps/web/src/ui/glass.css` owns the production chrome material, thin rim,
readable surfaces, dark viewer palette, and spring motion. `ui/Glass.jsx` owns
the clipped panel reveal, continuous account disclosure, and persistent viewer
display preferences.

## Contract

- Use `data-glass="clear"` for navigation, toolbars and display controls.
- Use `data-glass="readable"` for text-heavy panels and dialogs.
- Use `data-glass-theme="dark"` on a containing surface, not on individual controls.
- Reuse `--glass-spring`, `--glass-duration` and `--glass-layout-ease` for motion.
- Keep content, media and tools in separate layout tracks. A panel's spring
  transform must remain inside `GlassReveal`; the toolbar spans the entire viewer.
- The information sidebar fills its grid track. Only its body scrolls; expanding
  descriptions or person observations must not inherit floating-caption height
  limits. Keep its heading outside that scrolling body.
- Do not animate backdrop blur, surface opacity or filters on entry. The display
  setting may change blur explicitly. Closed controls are inert; reduced motion
  disables transitions.
- Keep component CSS limited to layout and content. Existing-selector adapters
  in the library handle older components without duplicating material recipes.
- Native focus rings, disabled/error states, and permission checks remain intact.
- Headers with dropdown children render their material on a pseudo-element;
  applying backdrop blur to the parent prevents the dropdown seeing the page.
  Expanding display settings reserves header space instead of covering controls.
- `GlassAccountMenu` uses one glass surface for the trigger and menu. Its reserved
  slot prevents navigation reflow while the surface stretches left and unfolds
  down. The body stays mounted for the reverse animation but is inert when closed.
  Never add a second backdrop or a detached dropdown plate inside this surface.

## Preserved Surfaces

The existing stacked folder cards, classic folder glyphs/column browser, album
preview images and folder hover interactions remain unchanged. Their original
`--liquid-glass-*` tokens in `liquidGlass.css` are intentionally retained. This
release does not rewrite stored folder styles, workspace state, or user roles.
The prototype's sample data and routes are not deployed.

Display preferences are local to the photo/video viewer and persist in
`mamage-viewer-appearance`. Header settings use the same store: blur applies to
shared chrome, while "dark viewer" changes only the viewer, preserving folder
styles. Changes synchronize across mounted viewers and browser tabs.
`ui/navigation.css` owns the separated navigation/search/account capsule layout,
not a second material system. Small screens wrap groups without hiding names.
Search stays around 340px (maximum 360px); unused wide-screen space stays blank.

## Verification

After `npm run build`, run from `apps/web`:

```sh
node scripts/test-glass-library-browser.cjs
node scripts/test-media-viewer-browser.cjs
MAMAGE_VIEWER_QA_DETAILS=1 node scripts/test-media-viewer-browser.cjs
node scripts/test-folder-sharing-browser.cjs
npm run test:user-name-browser
```

Set `MAMAGE_GLASS_BASELINE_DIST` to a pre-change web build for exact computed-style
comparison of both folder variants at 320, 390, 900 and 1440 pixels. Optional
`MAMAGE_GLASS_QA_DIR` saves screenshots. Browser tests use isolated local fixtures,
never live storage mutations.
