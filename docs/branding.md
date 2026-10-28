# Brabbler branding

Brabbler's mascot is the approved head-only, chatty robot: a cream speech-shaped
face, uneven eyes, toothy mouth, coral ear pods and a crooked antenna with a round
tip. Do not substitute the earlier floating speech bubble or redesign the antenna.
Native Pi packages, session paths and configuration remain Pi-owned.

## Artwork and application assets

- `tools/branding/robot.mjs` owns the editable vector geometry and talking/blinking
  poses. The static output is byte-identical to the approved SVG.
- `public/brand/robot.svg` is the self-contained transparent vector used beside
  Brabbler's name in the sidebar, empty chat and login page, and in the README.
- `public/icons/` contains opaque cream-background 180px Apple and 192/512px PWA
  icons. Manifest icon purpose remains `any`, not a new maskable guarantee.
- `app/favicon.ico` contains transparent native 16/32/48px PNG entries.
- The static demo receives identical artwork/icons, using its ordinary base-path
  helper for UI URLs. Demo synchronization is not proof of a demo production build.
- `docs/brand/robot-brabbling.gif` preserves the eight-frame talking/blinking study.
  The application and README use the static face, not a perpetually moving control.

Palette: ink `#19272F`, coral `#EE7C60`, face `#FFF9ED`. The service worker precaches
the vector alongside the existing PNG icon URLs; installing this revised worker
refreshes those cache entries. Browser/PWA icon adoption remains browser-managed.

## Regeneration

From this worktree's normal pinned Nix development shell:

```sh
nix develop
node tools/branding/generate.mjs
node tools/branding/generate.mjs --check
```

The generator uses Next's existing pinned Sharp dependency; no new dependency,
network image service or application build is needed. It updates the eleven named
main/demo/icon/animation outputs only. Edit the source geometry rather than a
generated file; `--check` compares all expected bytes without writing them.
Application asset tests also check manifest/Apple PNG dimensions, self-contained
SVG markup and favicon entry dimensions/bounds.

## README screenshot

`docs/screenshots/brabbler-workspace.png` is a real Chromium viewport capture of
the installed Nix package, not a drawn mock-up or a capture of the static demo.
All conversation text, tool history, project files and sessions are synthetic.
There are no live model turns, personal sessions, provider credentials or installed
host-service requests in this capture.

Regenerate using the existing ordinary browser sandbox:

```sh
nix run .#test -- e2e --group appearance
```

The appearance group runs its unchanged functional coverage first, then
`e2e/readme-screenshot.mjs` captures a separate 1440×960 dark desktop illustration
as `artifacts/readme-dark.png` in that run's appearance capsule. The fresh driver's
printed `run.json` locates the capsule. Inspect the pixels before copying that
specific artifact to `docs/screenshots/brabbler-workspace.png`; do not use a
wildcard, an unrelated historical screenshot, or live workspace data.

This illustration is outside the functional scenario counter. Its three fixture
session IDs are explicitly included in the exact startup catalogue, not harvested
from seed results. Existing browser/terminal coverage and failure collectors stay
in force, including errors observed during capture-context teardown. Regeneration
is not deployment or publication authority.
