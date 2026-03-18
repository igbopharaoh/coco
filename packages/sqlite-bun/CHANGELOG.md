# coco-cashu-sqlite-bun

## 1.1.2-rc.48

### Patch Changes

- db8f3c5: Add NUT-21/22 auth support (CAT/BAT lifecycle)
- befcdcf: Fix keyset denomination handling so mint key maps are preserved with string keys instead of being
  coerced to `Number` before persistence. This avoids precision loss for large denomination keys, keeps
  split logic limited to safe integer values, and adds storage migrations that clear cached keysets so
  they are re-fetched in the corrected format.
- 16f3de1: Add changeAmount and effectiveFee to finalized melt operations for accurate settlement reporting, with adapter persistence and legacy compatibility for older melt records.
- Updated dependencies [db8f3c5]
- Updated dependencies [3b29203]
- Updated dependencies [befcdcf]
- Updated dependencies [16f3de1]
- Updated dependencies [c9e378c]
- Updated dependencies [6b2ac82]
  - coco-cashu-core@1.1.2-rc.48

## 1.1.2-rc.47

### Patch Changes

- Updated dependencies [980cff1]
  - coco-cashu-core@1.1.2-rc.47

## 1.1.2-rc.46

### Patch Changes

- 381adae: fix: made sure type declaration files of sqlite-bun are emitted with the expected file name
  - coco-cashu-core@1.1.2-rc.46

## 1.1.2-rc.45

### Patch Changes

- 30aa519: Fix: sqlite-bun package was missing from release pipeline. It's included now
- Updated dependencies [30aa519]
  - coco-cashu-core@1.1.2-rc.45

## 1.1.2-rc.44

### Patch Changes

- f6d4e5f: feat: add new sqlite-bun storage adapter for sqlite support in bun runtimes
- Updated dependencies [8bb6f67]
  - coco-cashu-core@1.1.2-rc.44
