import React, { useEffect, useState } from 'react';
import {
  AppRegistry,
  BackHandler,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  EventBasicsEvidenceApp,
  eventBasicsEvidenceStates,
} from '../event-basics-option-2-entry';
import {
  EventSetupRecoveryEvidenceApp,
  eventSetupRecoveryEvidenceStates,
} from '../event-setup-recovery-option-2-entry';
import {
  CommunityFeedbackEvidenceApp,
  communityFeedbackEvidenceStates,
} from '../community-feedback-option-2-entry';
import {
  FeedbackComposeEvidenceApp,
  feedbackComposeEvidenceStates,
} from '../feedback-compose-option-2-entry';
import { EventsEvidenceApp } from '../events-option-2-entry';
import { TeamCollaborationEvidenceApp } from '../team-collaboration-option-2-entry';
import { TeamDecisionEvidenceApp } from '../team-decision-option-2-entry';
import { Button } from '../../src/design/primitives';
import { colors, spacing, typography } from '../../src/design/theme';
import { ScreenFrame } from '../../src/screens/ScreenFrame';

const surfaces = [
  {
    App: EventBasicsEvidenceApp,
    id: 'event-basics',
    label: 'Event-Basis',
    states: eventBasicsEvidenceStates,
  },
  {
    App: EventSetupRecoveryEvidenceApp,
    id: 'event-setup-recovery',
    label: 'Setup Recovery',
    states: eventSetupRecoveryEvidenceStates,
  },
  {
    App: CommunityFeedbackEvidenceApp,
    id: 'community-feedback',
    label: 'Community Feedback',
    states: communityFeedbackEvidenceStates,
  },
  {
    App: FeedbackComposeEvidenceApp,
    id: 'feedback-compose',
    label: 'Feedback Compose',
    states: feedbackComposeEvidenceStates,
  },
  {
    App: EventsEvidenceApp,
    id: 'events',
    label: 'Events',
    states: ['default'],
  },
  {
    App: TeamCollaborationEvidenceApp,
    id: 'team-assignments',
    label: 'Team Assignments',
    states: ['default'],
  },
  {
    App: TeamDecisionEvidenceApp,
    id: 'team-decision',
    label: 'Team Decision',
    states: ['default'],
  },
];

export const androidEvidenceStatusBarProps = Object.freeze({
  barStyle: 'dark-content',
});

export function AndroidEvidenceRunner() {
  const [selection, setSelection] = useState(null);

  useEffect(() => {
    if (!selection) return undefined;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setSelection(null);
        return true;
      },
    );
    return () => subscription.remove();
  }, [selection]);

  if (selection) {
    const surface = surfaces.find(
      candidate => candidate.id === selection.surface,
    );
    if (!surface) throw new Error('Unknown evidence surface.');
    const SelectedApp = surface.App;
    return (
      <>
        <StatusBar {...androidEvidenceStatusBarProps} />
        <SelectedApp evidenceState={selection.state} />
      </>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar {...androidEvidenceStatusBarProps} />
      <ScreenFrame
        description="Android-only Test-Harness. Wähle einen deterministischen pure-view Zustand; Android-Back kehrt hierher zurück."
        eyebrow="OPTION 2 · NATIVE QA"
        statusLabel="TEST-HARNESS"
        testID="android-evidence-selector"
        title="Evidence auswählen"
        tone="brand"
      >
        {surfaces.map(surface => (
          <View key={surface.id} style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
              {surface.label}
            </Text>
            {surface.states.map(state => (
              <Button
                key={state}
                label={state}
                onPress={() => setSelection({ state, surface: surface.id })}
                testID={`android-evidence-${surface.id}-${state}`}
                variant="surface"
              />
            ))}
          </View>
        ))}
      </ScreenFrame>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  heading: {
    ...typography.subheading,
    color: colors.text,
  },
  section: {
    gap: spacing.sm,
  },
});

AppRegistry.registerComponent('CrewNext', () => AndroidEvidenceRunner);
