import {
  FeedbackSubmissionController,
  MobileSyncEngine,
  type FeedbackSubmissionEvidence,
  type FeedbackSubmissionEvidenceRow,
  type OutboxEvidence,
  type OutboxEvidenceRow,
  type SqlDatabase,
} from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  useGatewayClient,
  useNativeE2ERequestId,
} from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { Button, Card, StatusChip } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { secureUuidV4 } from '../storage/secureRandom';
import { ScreenFrame } from './ScreenFrame';

const check = require('../assets/icons/check.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');
const rootEventIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;

type RouteProps = NativeStackScreenProps<
  RootStackParamList,
  'NativeE2EEvidence'
>;

type EvidenceState =
  | {
      database: SqlDatabase | null;
      key: string;
      status: 'loading';
    }
  | {
      database: SqlDatabase;
      key: string;
      status: 'error';
    }
  | {
      database: SqlDatabase;
      evidence: OutboxEvidence;
      feedbackEvidence: FeedbackSubmissionEvidence;
      key: string;
      status: 'ready';
    };

export function NativeE2EEvidenceRouteScreen({
  navigation,
  route,
}: RouteProps) {
  const rootEventId = route.params?.rootEventId;
  const requestId = useNativeE2ERequestId();
  if (
    !__DEV__ ||
    requestId === null ||
    !rootEventId ||
    !rootEventIdPattern.test(rootEventId)
  ) {
    return (
      <NativeE2EEvidenceView
        onBack={() => navigation.goBack()}
        status="disabled"
      />
    );
  }
  return (
    <NativeE2EEvidenceScreen
      onBack={() => navigation.goBack()}
      rootEventId={rootEventId}
    />
  );
}

export function NativeE2EEvidenceScreen({
  onBack,
  rootEventId,
}: {
  onBack(): void;
  rootEventId: string;
}) {
  const client = useGatewayClient();
  const requestId = useNativeE2ERequestId();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const activeDatabaseRef = useRef(privateDatabase.database);
  activeDatabaseRef.current = privateDatabase.database;
  const accountUserId =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? lifecycle.accountId
      : null;
  const scopeKey =
    __DEV__ &&
    requestId !== null &&
    client !== null &&
    accountUserId !== null &&
    rootEventIdPattern.test(rootEventId)
      ? `${requestId}:${accountUserId}:${rootEventId}`
      : null;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [state, setState] = useState<EvidenceState>({
    database: null,
    key: '',
    status: 'loading',
  });

  useEffect(() => {
    if (!scopeKey || !accountUserId || !client) {
      setState({ database: null, key: '', status: 'loading' });
      return;
    }
    let cancelled = false;
    const database = privateDatabase.database;
    const engine = new MobileSyncEngine(database, client, {
      activeAccountUserId: () => activeAccountRef.current,
      randomUUID: secureUuidV4,
    });
    const feedback = new FeedbackSubmissionController(database, null, {
      activeAccountUserId: () => activeAccountRef.current,
      randomUUID: secureUuidV4,
    });
    setState({
      database,
      key: scopeKey,
      status: 'loading',
    });
    Promise.all([
      engine.readOutboxEvidence(accountUserId, rootEventId),
      feedback.readEvidence(accountUserId, rootEventId),
    ]).then(
      ([evidence, feedbackEvidence]) => {
        if (
          !cancelled &&
          activeAccountRef.current === accountUserId &&
          activeDatabaseRef.current === database
        ) {
          setState({
            database,
            evidence,
            feedbackEvidence,
            key: scopeKey,
            status: 'ready',
          });
        }
      },
      () => {
        if (
          !cancelled &&
          activeAccountRef.current === accountUserId &&
          activeDatabaseRef.current === database
        ) {
          setState({ database, key: scopeKey, status: 'error' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [
    accountUserId,
    client,
    privateDatabase.database,
    refreshRequest,
    rootEventId,
    scopeKey,
  ]);

  if (!scopeKey) {
    return <NativeE2EEvidenceView onBack={onBack} status="disabled" />;
  }
  const visibleState =
    state.key === scopeKey && state.database === privateDatabase.database
      ? state
      : {
          database: privateDatabase.database,
          key: scopeKey,
          status: 'loading' as const,
        };
  return (
    <NativeE2EEvidenceView
      evidence={
        visibleState.status === 'ready' ? visibleState.evidence : undefined
      }
      feedbackEvidence={
        visibleState.status === 'ready'
          ? visibleState.feedbackEvidence
          : undefined
      }
      onBack={onBack}
      onRefresh={() => setRefreshRequest(value => value + 1)}
      status={visibleState.status}
    />
  );
}

export function NativeE2EEvidenceView({
  evidence,
  feedbackEvidence,
  onBack,
  onRefresh,
  status,
}: {
  evidence?: OutboxEvidence;
  feedbackEvidence?: FeedbackSubmissionEvidence;
  onBack(): void;
  onRefresh?(): void;
  status: 'disabled' | 'error' | 'loading' | 'ready';
}) {
  const ready = status === 'ready' && evidence;
  const icon = ready ? check : cloudOffline;
  const statusLabel =
    status === 'ready'
      ? 'LOKAL GEPRÜFT'
      : status === 'loading'
      ? 'WIRD GEPRÜFT'
      : status === 'error'
      ? 'PRÜFUNG FEHLGESCHLAGEN'
      : 'NICHT AKTIV';

  return (
    <ScreenFrame
      description="Read-only Nachweis aus dem verschlüsselten lokalen Ausgang. Es werden nur SHA-256-Fingerabdrücke gezeigt."
      eyebrow="NATIVE E2E"
      icon={icon}
      liveRegion={status === 'error' ? 'assertive' : 'polite'}
      statusLabel={statusLabel}
      testID="native-e2e-evidence"
      title="Sync-Beweis"
      tone={status === 'error' ? 'brand' : 'lavender'}
    >
      {status === 'loading' ? (
        <ActivityIndicator
          accessibilityLabel="Lokaler Sync-Nachweis wird geprüft"
          color={colors.textSecondary}
          size="large"
        />
      ) : status === 'error' ? (
        <Text accessibilityRole="alert" style={styles.message}>
          Der lokale Nachweis konnte nicht sicher gelesen werden.
        </Text>
      ) : status === 'disabled' ? (
        <Text accessibilityRole="alert" style={styles.message}>
          Dieser private Testzugang ist nicht aktiviert.
        </Text>
      ) : ready ? (
        <>
          <View
            accessibilityRole="summary"
            style={styles.summary}
            testID="native-e2e-evidence-metrics"
          >
            <EvidenceMetric label="Ausstehend" value={ready.pendingCount} />
            <EvidenceMetric
              label="Aufmerksamkeit"
              value={ready.attentionCount}
            />
            <EvidenceMetric
              label="Gekürzt"
              value={ready.truncated ? 'JA' : 'NEIN'}
            />
          </View>
          <Fingerprint
            label="Pull-Cursor · SHA-256"
            testID="native-e2e-cursor-fingerprint"
            value={ready.pullCursorFingerprint}
          />
          <View accessibilityRole="list" style={styles.rows}>
            {ready.rows.map((row, index) => (
              <EvidenceRow key={`${row.clientSequence}:${index}`} row={row} />
            ))}
          </View>
          {feedbackEvidence ? (
            <FeedbackEvidenceSection evidence={feedbackEvidence} />
          ) : null}
        </>
      ) : null}

      <View style={styles.actions}>
        {status !== 'disabled' ? (
          <Button
            accessibilityHint="Liest den verschlüsselten lokalen Ausgang erneut ohne Netzwerkzugriff."
            label="Lokal neu prüfen"
            loading={status === 'loading'}
            onPress={onRefresh}
            testID="native-e2e-evidence-refresh"
            variant="action"
          />
        ) : null}
        <Button
          label="Zurück"
          onPress={onBack}
          testID="native-e2e-evidence-back"
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

function EvidenceMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <Card
      accessible
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="text"
      style={styles.metric}
      tone="surface"
    >
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Card>
  );
}

function EvidenceRow({ row }: { row: OutboxEvidenceRow }) {
  return (
    <Card
      accessibilityRole="summary"
      style={styles.row}
      testID={`native-e2e-evidence-row-${row.clientSequence}`}
      tone={row.state === 'dead_letter' ? 'brand' : 'surface'}
    >
      <View style={styles.rowHeader}>
        <StatusChip label={row.state.toUpperCase()} tone="lavender" />
        <Text style={styles.sequence}>{`#${row.clientSequence}`}</Text>
      </View>
      <Text style={styles.kind}>{row.mutationKind}</Text>
      <Fingerprint label="Body · SHA-256" value={row.commandBodyFingerprint} />
      <Fingerprint
        label="Request-Body · SHA-256"
        value={row.requestBodyFingerprint}
      />
      <Fingerprint
        label="Idempotency-Key · SHA-256"
        value={row.idempotencyKeyFingerprint}
      />
    </Card>
  );
}

function FeedbackEvidenceSection({
  evidence,
}: {
  evidence: FeedbackSubmissionEvidence;
}) {
  return (
    <View style={styles.section} testID="native-e2e-feedback-evidence">
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Feedback-Ausgang
      </Text>
      <View accessibilityRole="summary" style={styles.summary}>
        <EvidenceMetric
          label="Feedback ausstehend"
          value={evidence.pendingCount}
        />
        <EvidenceMetric
          label="Feedback sendend"
          value={evidence.sendingCount}
        />
        <EvidenceMetric
          label="Feedback Aufmerksamkeit"
          value={evidence.attentionCount}
        />
        <EvidenceMetric
          label="Feedback zugestellt"
          value={evidence.deliveredCount}
        />
        <EvidenceMetric
          label="Feedback gekürzt"
          value={evidence.truncated ? 'JA' : 'NEIN'}
        />
      </View>
      <View accessibilityRole="list" style={styles.rows}>
        {evidence.rows.map((row, index) => (
          <FeedbackEvidenceRow key={index} row={row} />
        ))}
      </View>
    </View>
  );
}

function FeedbackEvidenceRow({ row }: { row: FeedbackSubmissionEvidenceRow }) {
  return (
    <Card
      accessibilityRole="summary"
      style={styles.row}
      tone={row.state === 'attention' ? 'brand' : 'surface'}
    >
      <View style={styles.rowHeader}>
        <StatusChip label={row.state.toUpperCase()} tone="lavender" />
        <Text style={styles.sequence}>
          {row.screenshotState?.toUpperCase() ?? 'OHNE SCREENSHOT'}
        </Text>
      </View>
      <Fingerprint
        label="Submission · Evidence SHA-256"
        value={row.submissionFingerprint}
      />
      <Fingerprint
        label="Idempotenz · Evidence SHA-256"
        value={row.idempotencyFingerprint}
      />
      <Fingerprint
        label="Screenshot · Evidence SHA-256"
        value={row.screenshotFingerprint}
      />
      <MatchValue
        label="Command-Fingerprint stimmt"
        value={row.commandFingerprintMatches}
      />
      <MatchValue
        label="Screenshot-Bindung stimmt"
        value={row.screenshotBindingMatches}
      />
      <MatchValue
        label="Screenshot-Metadaten stimmen"
        value={row.screenshotMetadataMatches}
      />
    </Card>
  );
}

function MatchValue({
  label,
  value,
}: {
  label: string;
  value: boolean | null;
}) {
  return (
    <Text style={styles.match}>
      {`${label}: ${
        value === null ? 'NICHT ANWENDBAR' : value ? 'JA' : 'NEIN'
      }`}
    </Text>
  );
}

function Fingerprint({
  label,
  testID,
  value,
}: {
  label: string;
  testID?: string;
  value: string | null;
}) {
  return (
    <View style={styles.fingerprint} testID={testID}>
      <Text style={styles.fingerprintLabel}>{label}</Text>
      <Text selectable style={styles.fingerprintValue}>
        {value ?? '—'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  fingerprint: {
    gap: spacing.xs,
  },
  fingerprintLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  fingerprintValue: {
    ...typography.caption,
    color: colors.text,
    flexShrink: 1,
  },
  kind: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.text,
  },
  match: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metric: {
    gap: spacing.xs,
    width: '100%',
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metricValue: {
    ...typography.numeric,
    color: colors.text,
  },
  row: {
    gap: spacing.md,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rows: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  sequence: {
    ...typography.bodyStrong,
    color: colors.textSecondary,
  },
  summary: {
    gap: spacing.md,
  },
});
