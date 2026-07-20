# Native measurements

## Normal font route (`01-*`)

- Android `font_scale`: `1.0`
- Composer input: `[92,1083][990,1419]`
- Submit control: `[92,1504][988,1646]`
- First entry card: `[92,1746][988,2129]`

## 200% font with visible IME (`02-*`)

- Android `font_scale`: `2.0`
- `mImeWindowVis=3`
- `mInputShown=true`
- IME frame: `[0,1517][1080,2400]`, visible
- Focused composer input: `[92,1181][990,1517]`
- Overlap: `max(0, input.bottom - ime.top) = max(0, 1517 - 1517) = 0 px`

The input was focused by resource ID through native semantic automation; no
coordinate tap, timer, or hard-coded keyboard offset was used.

## Submit after IME dismissal (`03-*`)

- `mImeWindowVis=0`
- `mInputShown=false`
- Submit control: `[92,1708][988,1882]`
- Native state: enabled and focusable
- Size at density 420: `896 x 174 px = 341.3 x 66.3 dp`

The keyboard was dismissed and the submit control reached with semantic
`scrollUntilVisible` by resource ID.

## TalkBack hierarchy regression (`04-*`)

- TalkBack service: enabled and bound
- Touch exploration: enabled
- Composer: `[92,1083][990,1419]`, focusable and focused
- Submit: `[92,1504][988,1646]`, focusable
- Entry card: `[92,1746][988,2129]`, not focusable
- Single combined message body: `[141,1890][939,2016]`, focusable
- Combined description: `Teammitglied. Decision log: owners and next steps are confirmed here. 20.07.2026, 03:10.`
- Refresh: `[92,2160][988,2301]`, focusable
- Back: `[92,2333][988,2400]`, focusable

Author and time are combined with the message body instead of appearing as
extra accessibility stops. The hierarchy and screenshot are the evidence for
this order; no new spoken-output recording is claimed.
