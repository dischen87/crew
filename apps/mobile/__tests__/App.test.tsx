import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) =>
    children,
}));

jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return { GestureHandlerRootView: View };
});

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../src/navigation/RootNavigator', () => {
  const { View } = require('react-native');
  return { RootNavigator: () => <View testID="root-navigator" /> };
});

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  PrivateBootstrapGate: ({
    children,
  }: {
    children: (status: 'signedOut') => React.ReactNode;
  }) => children('signedOut'),
}));

test('renders the provider tree and navigation root', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  expect(renderer!.root.findByProps({ testID: 'root-navigator' })).toBeTruthy();
  await ReactTestRenderer.act(() => {
    renderer!.unmount();
  });
});
