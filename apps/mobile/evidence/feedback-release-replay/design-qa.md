# Design 2 visual QA

Reference and implementation images were inspected together at matching logical viewports.

## iOS, 390 x 844

- List reference: `../option-2-native-visual/ios/community-feedback/logical/04-ready-normal-top-390x844.png`
- Composer reference: `../option-2-native-visual/ios/feedback-compose/logical/13-text-only-normal-top-390x844.png`
- Implementation: `ios/logical/`

The production composer preserves the Design 2 hierarchy, DM Sans typography, lavender background, yellow work surface, heavy dark outline, mint state icon, field spacing, and event-bound context card. The list preserves the same header, segmented control, filters, and primary action. Its additional lavender refresh-error card is the observed error-state delta; the capture is not labelled Ready.

## Android, 412 x 915

- List reference: `../option-2-native-visual/android/community-feedback/logical/01-ready-normal-detail-412x915.png`
- Composer reference: `../option-2-native-visual/android/feedback-compose/logical/06-text-only-normal-focused-412x915.png`
- Implementation: `android/logical/`

The production composer matches the Design 2 card geometry, type scale, content order, field proportions, color tokens, and high-contrast borders. The implementation capture is intentionally empty and unfocused, while the reference contains focused sample text. The list adds the same honest refresh-error card seen on iOS and therefore shifts the controls downward without clipping or horizontal overflow.

Android accessibility semantics were captured before text entry. Both platforms retained the expected native status/navigation chrome and readable tap-target sizing at the evidence viewports.
