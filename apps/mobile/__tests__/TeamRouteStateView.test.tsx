import React from 'react';
import { Button as NativeButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import { TeamRouteStateView } from '../src/screens/TeamRouteStateView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

test.each([
  ['loading', 'Laden neu starten', 'WIRD GELADEN'],
  ['concealed', 'Erneut versuchen', 'NICHT VERFÜGBAR'],
] as const)(
  'Team route %s state uses only the shared Option 2 recovery and back controls',
  async (kind, recoveryLabel, statusLabel) => {
    const onBack = jest.fn();
    const onRetry = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={metrics}>
          <TeamRouteStateView
            description="Geschützter Inhalt"
            kind={kind}
            onBack={onBack}
            onRetry={onRetry}
            testID={`route-${kind}`}
            title="Team-Inhalt"
          />
        </SafeAreaProvider>,
      );
    });

    expect(renderer!.root.findAllByType(NativeButton)).toHaveLength(0);
    expect(
      renderer!.root.findByProps({ accessibilityLabel: statusLabel }),
    ).toBeTruthy();
    const controls = renderer!.root.findAllByType(Button);
    expect(controls.map(control => control.props.label)).toEqual([
      recoveryLabel,
      'Zurück',
    ]);
    await ReactTestRenderer.act(() => controls[0].props.onPress());
    await ReactTestRenderer.act(() => controls[1].props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(() => renderer!.unmount());
  },
);
