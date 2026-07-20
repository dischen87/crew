import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useGatewayClient } from '../app/GatewayProvider';
import { Button, TextField } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { keychainPendingMagicLinkRequestStore } from '../storage/pendingMagicLinkRequest';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const check = require('../assets/icons/check.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');

type Props = NativeStackScreenProps<RootStackParamList, 'SignIn'>;
export type SignInViewState =
  | 'accepted'
  | 'idle'
  | 'invalid'
  | 'submitting'
  | 'unavailable';

export function SignInScreen(_props: Props) {
  const client = useGatewayClient();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<SignInViewState>('idle');
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isEmailCandidate(normalizedEmail)) {
      setState('invalid');
      return;
    }
    if (!client) {
      setState('unavailable');
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('submitting');
    try {
      const attempt = await keychainPendingMagicLinkRequestStore.getOrCreate(
        normalizedEmail,
      );
      await client.request('identityMagicLinksCreate', {
        body: { email: normalizedEmail },
        headers: { 'idempotency-key': attempt.idempotencyKey },
        signal: controller.signal,
      });
      await keychainPendingMagicLinkRequestStore.complete(
        normalizedEmail,
        attempt.idempotencyKey,
      );
      if (!controller.signal.aborted) setState('accepted');
    } catch {
      if (!controller.signal.aborted) setState('unavailable');
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  return (
    <SignInView
      email={email}
      onEmailChange={value => {
        setEmail(value);
        setState('idle');
      }}
      onSubmit={submit}
      state={state}
    />
  );
}

export function SignInView({
  email,
  onEmailChange,
  onSubmit,
  state,
}: {
  email: string;
  onEmailChange(value: string): void;
  onSubmit(): void;
  state: SignInViewState;
}) {
  const status = signInStatus(state);

  return (
    <ScreenFrame
      description="Gib deine E-Mail-Adresse ein. Wenn die Adresse verwendet werden kann, senden wir einen einmaligen Anmeldelink."
      eyebrow="SICHER ANMELDEN"
      icon={status.icon}
      liveRegion={state === 'invalid' ? 'assertive' : 'polite'}
      statusLabel={status.label}
      testID="sign-in-view"
      title="Mit E-Mail anmelden"
      tone={status.tone}
    >
      <TextField
        autoCapitalize="none"
        autoComplete="email"
        disabled={state === 'submitting'}
        error={
          state === 'invalid'
            ? 'Gib eine gültige E-Mail-Adresse ein.'
            : undefined
        }
        helpText="Passwortlos und nur für diesen Anmeldeversuch."
        inputMode="email"
        label="E-Mail-Adresse"
        onChangeText={onEmailChange}
        onSubmitEditing={onSubmit}
        placeholder="name@beispiel.ch"
        returnKeyType="send"
        testID="sign-in-email"
        textContentType="emailAddress"
        value={email}
      />
      {status.message ? (
        <Text
          accessibilityLiveRegion={
            state === 'unavailable' ? 'assertive' : 'polite'
          }
          accessibilityRole={state === 'unavailable' ? 'alert' : undefined}
          style={styles.message}
        >
          {status.message}
        </Text>
      ) : null}
      <Button
        icon={<ScreenIcon source={arrowRight} />}
        label={status.action}
        loading={state === 'submitting'}
        onPress={onSubmit}
        style={styles.action}
        testID="sign-in-submit"
        variant="action"
      />
    </ScreenFrame>
  );
}

function signInStatus(state: SignInViewState) {
  switch (state) {
    case 'idle':
      return {
        action: 'Mit E-Mail fortfahren',
        icon: arrowRight,
        label: 'EINMALIGER ANMELDELINK',
        message: null,
        tone: 'surface' as const,
      };
    case 'invalid':
      return {
        action: 'Eingabe prüfen',
        icon: undefined,
        label: 'EINGABE PRÜFEN',
        message: null,
        tone: 'lavender' as const,
      };
    case 'submitting':
      return {
        action: 'Anfrage wird gesendet',
        icon: arrowRight,
        label: 'ANFRAGE WIRD GESENDET',
        message: 'Du bist noch nicht angemeldet.',
        tone: 'lavender' as const,
      };
    case 'accepted':
      return {
        action: 'Link erneut senden',
        icon: check,
        label: 'ANFRAGE ANGENOMMEN',
        message:
          'Wenn die Adresse verwendet werden kann, senden wir einen Anmeldelink.',
        tone: 'action' as const,
      };
    case 'unavailable':
      return {
        action: 'Erneut versuchen',
        icon: cloudOffline,
        label: 'GERADE NICHT VERFÜGBAR',
        message:
          'Die Anfrage ist gerade nicht möglich. Prüfe deine Verbindung und versuche es erneut.',
        tone: 'brand' as const,
      };
  }
}

function isEmailCandidate(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
  message: {
    ...typography.body,
    color: colors.text,
  },
});
