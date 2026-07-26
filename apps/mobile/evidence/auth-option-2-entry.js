import React from 'react';
import { Alert, AppRegistry, Settings, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EmailIdentityView } from '../src/screens/EmailIdentityScreen';
import { InboundGateView } from '../src/screens/InboundGateScreen';
import { InvitePreviewView } from '../src/screens/InvitePreviewScreen';
import { PrivateAccessView } from '../src/screens/PrivateAccessScreen';
import { SignInView } from '../src/screens/SignInScreen';
import { UnavailableView } from '../src/screens/UnavailableScreen';

const preview = {
  emailBound: true,
  endsAt: '2026-09-24T18:00:00.000Z',
  role: 'participant',
  rootEventId: 'evt_evidence_turkey',
  startsAt: '2026-09-20T08:00:00.000Z',
  title: 'Turkey Golf Tour',
  usable: true,
};

const longPreview = {
  ...preview,
  role: 'organizer',
  title:
    'Strategiewoche für Produkt, Betrieb und internationale Partnerorganisationen',
};

function action(label) {
  Alert.alert(label, 'Evidence interaction');
}

function EvidenceSurface() {
  const state = Settings.get('CrewEvidenceState') ?? 'sign-in-accepted';

  switch (state) {
    case 'identity-expired':
      return (
        <EmailIdentityView
          onRequestNewLink={() => action('Neuen Link senden')}
          onRetry={() => action('Erneut versuchen')}
          phase="expired"
        />
      );
    case 'invite-signed-out':
      return (
        <InvitePreviewView
          onBackToEvents={() => action('Zu Events')}
          onRedeem={() => action('Mit E-Mail fortfahren')}
          onRetry={() => action('Erneut versuchen')}
          onRetrySession={() => action('Zugang erneut prüfen')}
          onSwitchAccount={() => action('Konto wechseln')}
          phase="ready"
          preview={preview}
          redeeming={false}
          sessionStatus="signedOut"
        />
      );
    case 'invite-long-text':
      return (
        <InvitePreviewView
          onBackToEvents={() => action('Zu Events')}
          onRedeem={() => action('Mit E-Mail fortfahren')}
          onRetry={() => action('Erneut versuchen')}
          onRetrySession={() => action('Zugang erneut prüfen')}
          onSwitchAccount={() => action('Konto wechseln')}
          phase="ready"
          preview={longPreview}
          redeeming={false}
          sessionStatus="signedOut"
        />
      );
    case 'invite-account-mismatch':
      return (
        <InvitePreviewView
          onBackToEvents={() => action('Zu Events')}
          onRedeem={() => action('Einladung annehmen')}
          onRetry={() => action('Erneut versuchen')}
          onRetrySession={() => action('Zugang erneut prüfen')}
          onSwitchAccount={() => action('Konto wechseln')}
          phase="accountMismatch"
          preview={null}
          redeeming={false}
          sessionStatus="ready"
        />
      );
    case 'private-unavailable':
      return (
        <PrivateAccessView
          onAction={() => action('Erneut versuchen')}
          state="unavailable"
        />
      );
    case 'inbound-retryable':
      return (
        <InboundGateView
          onEvents={() => action('Zu Events')}
          onRetry={() => action('Erneut versuchen')}
          state={{ kind: 'retryable' }}
        />
      );
    case 'unavailable':
      return <UnavailableView onEvents={() => action('Zu Events')} />;
    default:
      return (
        <SignInView
          email="crew@example.test"
          onEmailChange={() => undefined}
          onSubmit={() => action('Link erneut senden')}
          state="accepted"
        />
      );
  }
}

function AuthEvidenceApp() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" hidden={false} />
      <EvidenceSurface />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => AuthEvidenceApp);
