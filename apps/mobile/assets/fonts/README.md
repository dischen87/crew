# DM Sans

The app embeds the upright DM Sans variable TrueType font under the SIL Open Font License 1.1.

- Upstream: `google/fonts` at commit [`389b770410cc0b7c21c85673bfa2077420fe7f65`](https://github.com/google/fonts/tree/389b770410cc0b7c21c85673bfa2077420fe7f65/ofl/dmsans)
- Upstream font: [`ofl/dmsans/DMSans[opsz,wght].ttf`](https://github.com/google/fonts/blob/389b770410cc0b7c21c85673bfa2077420fe7f65/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf)
- Upstream license: [`ofl/dmsans/OFL.txt`](https://github.com/google/fonts/blob/389b770410cc0b7c21c85673bfa2077420fe7f65/ofl/dmsans/OFL.txt)
- Font SHA-256: `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d`
- Local LF-normalized OFL SHA-256: `2af94f4fb533be8fa23282eb33e08ca311ddf47c2f32777e2040b282deeec65c`
- Internal typographic family: `DM Sans` (OpenType name ID 16)
- Version: `4.004`; axes: optical size `9..40`, weight `100..1000`

The binary is unchanged from upstream; only its installed filename is shorter. iOS includes it as a target resource and declares `DM Sans.ttf` in `UIAppFonts`. Android packages this directory as app assets and registers `fonts/DM Sans.ttf` as the React Native family `DM Sans` during application startup.
