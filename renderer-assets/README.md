# Canvas renderer assets

## mermaid-12.3.0.min.js

- Source: npm `mermaid@12.3.0`, file `dist/mermaid.min.js` (standalone IIFE bundle), MIT license (see `MERMAID-LICENSE`).
- Tarball integrity, checked against the registry on 2026-11-05:
  `sha512-4113TdXeLAsMruJ79OpFL5O8+LTFXhQqZ260rF3tgUmiNAtRm4Uume04I+65PRN6yZ69J4f8rVYWW8zRk65UYw==`
  (shasum `e860165e0a19778ebef98038c0436bbee6783ba9`).
- One reviewed transformation: the 3 occurrences of `<!--` were rewritten as `\x3C!--`. All 3 sit inside JS string or regex
  literals, so the meaning is unchanged, and the bundle stays safe to inline in an HTML `<script>`. The bundle has no
  `</script` and no `sourceMappingURL`.
- Final UTF-8 bytes SHA-256 (base64), pinned as `MERMAID_ASSET_SHA256` in `lib/canvas-renderer.mjs`:
  `O7YtQ7scm1a5PiqMsp3oLImchSSI9PwMR5h0OQtjSjk=`
- Vendored as an immutable file, not installed from npm, so deploys never fetch it.
  To upgrade: repeat these steps for the new version, re-review the bundle, and update the pin and this file together.
