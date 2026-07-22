import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { contrastRatio, contrastThresholds } from '../src/design/contrast';
import { colors } from '../src/design/theme';
import { RecapView, type RecapViewModel } from '../src/screens/RecapView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};
const captionFieldRef = `rcf_${'A'.repeat(43)}`;

const publishedRecapModel: RecapViewModel = {
  activeShareExpiresAt: null,
  activeShareKind: null,
  busyAction: null,
  busyExternalAuthority: null,
  busyExternalDecision: null,
  busyExternalFieldId: null,
  eventTitle: 'Turkey Golf Tour',
  items: [
    {
      body: 'Ankommen, einchecken und gemeinsam in die Reise starten.',
      externalBody: {
        actorCanDecide: ['manager'],
        authorDecision: 'unknown',
        managerDecision: 'unknown',
        requiredAuthorities: ['manager'],
        selected: false,
      },
      id: 'recap-welcome',
      title: 'Willkommen in Belek',
    },
    {
      body: 'Die erste Runde führte die Crew über den Carya Golf Course.',
      externalBody: {
        actorCanDecide: ['manager'],
        authorDecision: 'unknown',
        managerDecision: 'unknown',
        requiredAuthorities: ['author', 'manager'],
        selected: false,
      },
      id: 'recap-carya',
      title: 'Auftakt auf dem Carya Golf Course',
    },
  ],
  message: null,
  online: true,
  phase: 'published',
  refreshedAt: '2026-09-24T18:02:00.000Z',
  role: 'organizer',
};

async function render(
  model: RecapViewModel,
  callbacks = callbacksForView(),
  initialMetrics = metrics,
) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <RecapView model={model} {...callbacks} />
      </SafeAreaProvider>,
    );
  });
  return { callbacks, renderer: renderer! };
}

test('organizer reviews published member content and creates an explicit title-only link', async () => {
  const { callbacks, renderer } = await render(publishedRecapModel);
  const primary = renderer.root.findByProps({
    testID: 'recap-primary-action',
  });
  expect(primary.props.label).toBe('Titel-Link teilen');
  expect(primary.props.accessibilityHint).toContain('siebentägigen Titel-Link');
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'EXTERN: NUR TITEL' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'recap-remove-action' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'recap-external-share-action' }).props
      .disabled,
  ).toBe(true);

  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(callbacks.onShare).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'recap-external-select-recap-welcome' })
      .props.onPress(),
  );
  expect(callbacks.onExternalSelectionToggle).toHaveBeenCalledWith(
    'recap-welcome',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('manager sees the exact selected text and only session-scoped authority state before sharing', async () => {
  const exactSelection: RecapViewModel = {
    ...publishedRecapModel,
    items: [
      {
        ...publishedRecapModel.items[0]!,
        externalBody: {
          actorCanDecide: ['manager'],
          authorDecision: 'unknown',
          managerDecision: 'unknown',
          requiredAuthorities: ['manager'],
          selected: true,
        },
        id: 'evt_private_source',
      },
      {
        ...publishedRecapModel.items[1]!,
        externalBody: {
          actorCanDecide: ['manager'],
          authorDecision: 'unknown',
          managerDecision: 'unknown',
          requiredAuthorities: ['author', 'manager'],
          selected: true,
        },
        id: 'fed_private_source',
      },
    ],
  };
  const { callbacks, renderer } = await render(exactSelection);
  const text = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(text.match(/EXAKTE TEXTVORSCHAU/g)).toHaveLength(2);
  expect(text).toContain(
    'Für genau diesen Text gelten die folgenden externen Freigaben',
  );
  expect(
    text.match(/Ankommen, einchecken und gemeinsam in die Reise starten\./g),
  ).toHaveLength(1);
  expect(text).toContain('Managerfreigabe: nicht bestätigt.');
  expect(text).toContain('Autorfreigabe: nicht bestätigt.');
  expect(text).not.toContain('in dieser Sitzung bestätigt');
  expect(text).not.toContain('evt_private_source');
  expect(text).not.toContain('fed_private_source');

  const grant = renderer.root.findByProps({
    testID: 'recap-external-manager-grant-fed_private_source',
  });
  const withdraw = renderer.root.findByProps({
    testID: 'recap-external-manager-withdraw-fed_private_source',
  });
  const share = renderer.root.findByProps({
    testID: 'recap-external-share-action',
  });
  expect(share.props.label).toBe('Auswahl prüfen und teilen');
  expect(share.props.disabled).toBe(false);
  await ReactTestRenderer.act(() => grant.props.onPress());
  expect(callbacks.onExternalDecision).toHaveBeenCalledWith(
    'fed_private_source',
    'manager',
    'grant',
  );
  await ReactTestRenderer.act(() => withdraw.props.onPress());
  expect(callbacks.onExternalDecision).toHaveBeenCalledWith(
    'fed_private_source',
    'manager',
    'withdraw',
  );
  await ReactTestRenderer.act(() => share.props.onPress());
  expect(callbacks.onShareExact).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('Design 2 exposes caption text as a separate exact field without media or opaque identifiers', async () => {
  const captionModel: RecapViewModel = {
    ...publishedRecapModel,
    items: publishedRecapModel.items.map((item, index) =>
      index === 1
        ? {
            ...item,
            externalCaptions: [
              {
                actorCanDecide: ['author', 'manager'],
                attachmentOrdinal: 0,
                authorDecision: 'unknown',
                caption: 'Dinner nach der Golfrunde',
                id: `caption:${captionFieldRef}`,
                managerDecision: 'grant',
                requiredAuthorities: ['author', 'manager'],
                selected: true,
              },
            ],
          }
        : item,
    ),
  };
  const { callbacks, renderer } = await render(captionModel);
  const text = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');

  expect(text).toContain('BILDBESCHREIBUNG 1');
  expect(text).toContain('Dinner nach der Golfrunde');
  expect(text).toContain('nicht das Bild');
  expect(text).not.toContain(captionFieldRef);
  expect(text).not.toContain('image/');
  expect(text).not.toContain('attachment');

  const safeTestId = 'caption-recap-carya-0';
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: `recap-external-select-${safeTestId}` })
      .props.onPress(),
  );
  expect(callbacks.onExternalSelectionToggle).toHaveBeenCalledWith(
    `caption:${captionFieldRef}`,
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({
        testID: `recap-external-author-withdraw-${safeTestId}`,
      })
      .props.onPress(),
  );
  expect(callbacks.onExternalDecision).toHaveBeenCalledWith(
    `caption:${captionFieldRef}`,
    'author',
    'withdraw',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('feed authors act only for author authority while participants and viewers never gain manager controls', async () => {
  const authorModel: RecapViewModel = {
    ...publishedRecapModel,
    items: [
      {
        ...publishedRecapModel.items[0]!,
        externalBody: {
          actorCanDecide: [],
          authorDecision: 'unknown',
          managerDecision: 'grant',
          requiredAuthorities: ['manager'],
          selected: false,
        },
      },
      {
        ...publishedRecapModel.items[1]!,
        externalBody: {
          actorCanDecide: ['author'],
          authorDecision: 'withdraw',
          managerDecision: 'grant',
          requiredAuthorities: ['author', 'manager'],
          selected: false,
        },
      },
    ],
    role: 'participant',
  };
  const author = await render(authorModel);
  const authorText = author.renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(authorText).toContain('Autorfreigabe: widerrufen.');
  expect(authorText).toContain('Managerfreigabe: aktuell bestätigt.');
  expect(authorText.match(/Autorfreigabe:/g)).toHaveLength(1);
  expect(
    author.renderer.root.findAllByProps({
      testID: 'recap-external-manager-grant-recap-carya',
    }),
  ).toHaveLength(0);
  expect(
    author.renderer.root.findAllByProps({
      testID: 'recap-external-select-recap-carya',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() =>
    author.renderer.root
      .findByProps({ testID: 'recap-external-author-grant-recap-carya' })
      .props.onPress(),
  );
  expect(author.callbacks.onExternalDecision).toHaveBeenCalledWith(
    'recap-carya',
    'author',
    'grant',
  );
  await ReactTestRenderer.act(() => author.renderer.unmount());

  const viewer = await render({
    ...authorModel,
    items: authorModel.items.map(item => ({
      ...item,
      externalBody: item.externalBody
        ? { ...item.externalBody, actorCanDecide: [] }
        : null,
    })),
    role: 'viewer',
  });
  expect(
    viewer.renderer.root.findAllByProps({
      testID: 'recap-external-author-grant-recap-carya',
    }),
  ).toHaveLength(0);
  expect(
    viewer.renderer.root.findAllByProps({
      testID: 'recap-external-share-action',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => viewer.renderer.unmount());
});

test('one in-flight decision locks every exact-field control', async () => {
  const busy: RecapViewModel = {
    ...publishedRecapModel,
    busyExternalAuthority: 'manager',
    busyExternalDecision: 'grant',
    busyExternalFieldId: 'recap-welcome',
    items: publishedRecapModel.items.map(item => ({
      ...item,
      externalBody: item.externalBody
        ? { ...item.externalBody, selected: true }
        : null,
    })),
  };
  const { renderer } = await render(busy);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-recap-welcome',
    }).props.disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-recap-carya',
    }).props.disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-manager-grant-recap-welcome',
    }).props.loading,
  ).toBe(true);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-manager-grant-recap-carya',
    }).props.disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'recap-external-share-action' }).props
      .disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'recap-primary-action' }).props
      .disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'recap-remove-action' }).props.disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('one exact-share request locks title, removal, selection, and decisions while preserving its spinner', async () => {
  const busy: RecapViewModel = {
    ...publishedRecapModel,
    busyAction: 'shareExact',
    items: publishedRecapModel.items.map(item => ({
      ...item,
      externalBody: item.externalBody
        ? { ...item.externalBody, selected: true }
        : null,
    })),
  };
  const { renderer } = await render(busy);
  expect(
    renderer.root.findByProps({ testID: 'recap-primary-action' }).props
      .disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'recap-remove-action' }).props.disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-recap-welcome',
    }).props.disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-manager-grant-recap-carya',
    }).props.disabled,
  ).toBe(true);
  const exactShare = renderer.root.findByProps({
    testID: 'recap-external-share-action',
  });
  expect(exactShare.props.disabled).toBe(true);
  expect(exactShare.props.loading).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('exact link and decisions stay explicitly session-local and freeze the active selection', async () => {
  const sessionState: RecapViewModel = {
    ...publishedRecapModel,
    activeShareExpiresAt: '2026-10-01T18:00:00.000Z',
    activeShareKind: 'exact-body',
    items: [
      {
        ...publishedRecapModel.items[0]!,
        externalBody: {
          actorCanDecide: ['manager'],
          authorDecision: 'unknown',
          managerDecision: 'grant',
          requiredAuthorities: ['manager'],
          selected: true,
        },
      },
      {
        ...publishedRecapModel.items[1]!,
        externalBody: {
          actorCanDecide: ['manager'],
          authorDecision: 'grant',
          managerDecision: 'withdraw',
          requiredAuthorities: ['author', 'manager'],
          selected: false,
        },
      },
    ],
  };
  const { callbacks, renderer } = await render(sessionState);
  const text = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(text).toContain('Managerfreigabe: aktuell bestätigt.');
  expect(text).toContain('Managerfreigabe: widerrufen.');
  expect(text).toContain('Autorfreigabe: aktuell bestätigt.');
  expect(text).toContain('In dieser Sitzung erstellt');
  expect(
    renderer.root.findAllByProps({ testID: 'recap-primary-action' }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-recap-welcome',
    }).props.disabled,
  ).toBe(true);
  const share = renderer.root.findByProps({
    testID: 'recap-external-share-action',
  });
  expect(share.props.label).toBe('Text-Link erneut teilen');
  await ReactTestRenderer.act(() => share.props.onPress());
  expect(callbacks.onShareExact).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'recap-revoke-action' })
      .props.onPress(),
  );
  expect(callbacks.onRevoke).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('participant can read a published offline snapshot without manager controls or foreign identifiers', async () => {
  const participant: RecapViewModel = {
    ...publishedRecapModel,
    online: false,
    role: 'participant',
  };
  const { renderer } = await render(participant);
  const text = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(text).toContain('Offline-Kopie');
  expect(text).toContain('Willkommen in Belek');
  expect(text).not.toContain('evt_');
  expect(text).not.toContain('sourceRevision');
  expect(
    renderer.root.findByProps({ testID: 'recap-primary-action' }).props.label,
  ).toBe('Online prüfen');
  expect(
    renderer.root.findAllByProps({ testID: 'recap-remove-action' }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({ testID: 'recap-revoke-action' }),
  ).toHaveLength(0);
  expect(text).not.toContain('EXTERN: NUR TITEL');
  expect(text).toContain('EXAKTE TEXTVORSCHAU');
  expect(text).toContain('Managerfreigabe: nicht bestätigt.');
  expect(
    renderer.root.findAllByProps({ testID: 'recap-external-share-action' }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({
      testID: 'recap-external-select-recap-welcome',
    }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({
      testID: 'recap-external-manager-grant-recap-welcome',
    }),
  ).toHaveLength(0);
  const moment2 = renderer.root
    .findAllByType(Text)
    .find(node => [node.props.children].flat(Infinity).join('') === 'MOMENT 2');
  expect(moment2).toBeDefined();
  expect(StyleSheet.flatten(moment2?.props.style).color).toBe(colors.text);
  expect(
    StyleSheet.flatten(
      renderer.root.findByProps({
        children: 'Die erste Runde führte die Crew über den Carya Golf Course.',
      }).props.style,
    ).color,
  ).toBe(colors.text);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offline manager never sees a generate, publish, remove, or revoke promise', async () => {
  const offlineDraft: RecapViewModel = {
    ...publishedRecapModel,
    activeShareExpiresAt: null,
    online: false,
    phase: 'draft',
  };
  const { callbacks, renderer } = await render(offlineDraft);
  const primary = renderer.root.findByProps({
    testID: 'recap-primary-action',
  });
  expect(primary.props.label).toBe('Online prüfen');
  expect(primary.props.accessibilityHint).toContain(
    'Es wird keine Änderung vorgemerkt',
  );
  expect(
    renderer.root.findAllByProps({ testID: 'recap-remove-action' }),
  ).toHaveLength(0);

  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(callbacks.onRefresh).toHaveBeenCalledTimes(1);
  expect(callbacks.onGenerate).not.toHaveBeenCalled();
  expect(callbacks.onPublish).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('active in-memory share can be shared offline while revoke remains absent', async () => {
  const activeShare: RecapViewModel = {
    ...publishedRecapModel,
    activeShareExpiresAt: '2026-10-01T18:00:00.000Z',
    activeShareKind: 'title-only',
    online: false,
  };
  const { callbacks, renderer } = await render(activeShare);
  const primary = renderer.root.findByProps({
    testID: 'recap-primary-action',
  });
  expect(primary.props.label).toBe('Link erneut teilen');
  expect(
    renderer.root.findAllByProps({ testID: 'recap-revoke-action' }),
  ).toHaveLength(0);
  const expiry = renderer.root
    .findAllByType(Text)
    .find(node =>
      textInsideNode(node).startsWith('In dieser Sitzung erstellt'),
    );
  const expiryColor = StyleSheet.flatten(expiry?.props.style).color as string;
  expect(expiryColor).toBe(colors.text);
  expect(
    contrastRatio(expiryColor, colors.surfaceAccent),
  ).toBeGreaterThanOrEqual(contrastThresholds.normalText);
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(callbacks.onShare).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('concealed recovery keeps scrolling below the safe area and 200 percent text viable', async () => {
  const concealed: RecapViewModel = {
    activeShareExpiresAt: null,
    activeShareKind: null,
    busyAction: null,
    busyExternalAuthority: null,
    busyExternalDecision: null,
    busyExternalFieldId: null,
    eventTitle: 'Dein Event',
    items: [],
    message: 'Dieser Rückblick ist nicht verfügbar.',
    online: true,
    phase: 'concealed',
    refreshedAt: null,
    role: null,
  };
  const { renderer } = await render(concealed);
  const scroll = renderer.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    flexGrow: 1,
    paddingBottom: 34,
    paddingTop: 0,
  });
  expect(StyleSheet.flatten(scroll.props.style)).toMatchObject({
    marginTop: 47,
  });
  const text = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(text).toContain('Geschützte Inhalte bleiben verborgen');
  expect(text).not.toMatch(/entfernt|abgelaufen|Konto|Berechtigung/);
  expect(
    renderer.root.findByProps({ testID: 'recap-primary-action' }).props.label,
  ).toBe('Erneut versuchen');
  const stateCopy = renderer.root.findByProps({
    children: 'Geschützte Inhalte bleiben verborgen. Prüfe den Zugang erneut.',
  });
  const stateCopyColor = StyleSheet.flatten(stateCopy.props.style)
    .color as string;
  expect(stateCopyColor).toBe(colors.text);
  expect(
    contrastRatio(stateCopyColor, colors.surfaceBrand),
  ).toBeGreaterThanOrEqual(contrastThresholds.normalText);
  await ReactTestRenderer.act(() => renderer.unmount());

  const zeroInset = await render(concealed, callbacksForView(), {
    ...metrics,
    insets: { ...metrics.insets, top: 0 },
  });
  const zeroInsetScroll = zeroInset.renderer.root.findByType(ScrollView);
  expect(StyleSheet.flatten(zeroInsetScroll.props.style)).toMatchObject({
    marginTop: 0,
  });
  expect(
    StyleSheet.flatten(zeroInsetScroll.props.contentContainerStyle),
  ).toMatchObject({ paddingTop: 12 });
  await ReactTestRenderer.act(() => zeroInset.renderer.unmount());
});

function callbacksForView() {
  return {
    onBack: jest.fn(),
    onExternalDecision: jest.fn(),
    onExternalSelectionToggle: jest.fn(),
    onGenerate: jest.fn(),
    onPublish: jest.fn(),
    onRefresh: jest.fn(),
    onRemove: jest.fn(),
    onRevoke: jest.fn(),
    onShare: jest.fn(),
    onShareExact: jest.fn(),
  };
}

function textInsideNode(node: ReactTestRenderer.ReactTestInstance) {
  return [node.props.children].flat(Infinity).join('');
}
