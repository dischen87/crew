# Audited source hashes

SHA-256 at final gate time:

| Source | SHA-256 |
| --- | --- |
| `apps/mobile/src/screens/TeamFeedScreen.tsx` | `d355a4df3011b41a59c585357d8bfffd41a2a347d3190aaf3963d5acfd13c138` |
| `apps/mobile/src/screens/ScreenFrame.tsx` | `de940faf4ba1afc2474be06ce722d327932d048df85f3895d617c41ae091ef64` |
| `apps/mobile/src/design/primitives.tsx` | `36a379cf91e4adb7b556a29618c6ad316c4edcb18c6298ce1a413e8f22387355` |
| `apps/mobile/__tests__/TeamFeed.test.tsx` | `430b0059212101652deae04b2250dd91b768d96f9be049c434e728620cf3297c` |

The failed keyboard-scroll experiment was reverted before these hashes were
calculated. The hashes represent the retained accessibility hardening.
