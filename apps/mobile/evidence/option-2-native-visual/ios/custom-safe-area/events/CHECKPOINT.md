# Events native iOS checkpoint

Frozen at `2026-07-19T13:56:53Z` before deleting the regenerable iOS
DerivedData directory because host free space had fallen below the agreed
1.5 GiB floor.

- Device: iPhone 16e simulator (`F3FF7E09-1860-43BA-BE9B-E897E1DE4FA3`), iOS 26.2
- Accessibility state: Large content size
- Native app binary SHA-256: `967688b9e9a46d1a305dfe2583ee0038526349b5395a169e294a1f7ad27373e7`
- Embedded `main.jsbundle` SHA-256: `2f2be131a3ff24de70ca5b68e7e783963a837696e3783759aee6d9ccdccf4c32`
- Entry SHA-256: `33c280606fcb3ff5456cf221d4f4f10c449d22ab081bb2a7e0f7fb9582be7e3f`
- `EventsView.tsx` SHA-256: `bc9e736e427b35b923308485f9599be70087fdd0d8ca9f983eec02b92968a585`
- `EventsView.test.tsx` SHA-256: `c781164141d89b31f7a0351b9f254368321019309675fb34ea72e64ade6bbcb6`

## Captures

| State | Raw capture | Raw SHA-256 | Logical capture | Logical SHA-256 |
| --- | --- | --- | --- | --- |
| Large, top | `raw/01-events-large-top-1170x2532.png` | `59bf50c89d45ed60a1d35fa3f87c94b02305f87ed215876c840fc146dc4faf04` | `logical/01-events-large-top-390x844.png` | `e3ca3345d6a6eac49e5c8c3d02e9bfedfec6e89e670d323b184882017df6a7c2` |
| Large, scrolled | `raw/02-events-large-scrolled-1170x2532.png` | `373f87e5b9ea61ff9146de426ebd6bb03d90cd8c19bf09410baedea2edd9c06f` | `logical/02-events-large-scrolled-390x844.png` | `5a77ff76c34c0b748365806bcbfcea2191cf171e4176cbd2fb1d18387c105dee` |

Both captures were visually inspected at their original logical resolution.
The top state keeps the title and introductory text below the status bar. The
scrolled state keeps content below the status bar while exposing the second
event card; no horizontal overflow or character-by-character wrapping is
visible.

The deleted DerivedData directory was a regenerable build artifact and is not
part of this evidence checkpoint.
