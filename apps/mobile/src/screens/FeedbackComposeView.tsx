import type { FeedbackDuplicateSuggestion } from '@crew/mobile-data';
import type { ImageSourcePropType } from 'react-native';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Button,
  Card,
  StatusChip,
  SyncStatus,
  TextField,
} from '../design/primitives';
import {
  borders,
  colors,
  componentMetrics,
  elevations,
  radii,
  spacing,
  typography,
} from '../design/theme';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const icons = {
  caretRight: require('../assets/icons/caret-right.png'),
  chat: require('../assets/icons/chat.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
} satisfies Record<string, ImageSourcePropType>;

export type FeedbackComposeVisibility = 'event' | 'private';
export type FeedbackComposeDeliveryState =
  | 'attention'
  | 'delivered'
  | 'pending'
  | 'sending';

export type FeedbackDiagnosticsPreview = {
  appVersion: string;
  buildNumber: string;
  contextCategory: string;
  platform: string;
};

export type FeedbackComposeScreenshotState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | {
      busy: boolean;
      consented: boolean;
      kind: 'preview';
      previewDataUri: string;
    };

export type FeedbackDuplicateSuggestionsViewState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'skipped' }
  | { kind: 'error' }
  | {
      items: readonly FeedbackDuplicateSuggestion[];
      kind: 'ready';
      source: 'cache' | 'network';
    };

export type FeedbackComposeViewState =
  | {
      body: string;
      canShareWithEvent: boolean;
      diagnosticsConsented: boolean;
      diagnosticsPreview: FeedbackDiagnosticsPreview | null;
      error: string | null;
      kind: 'editing';
      online: boolean;
      screenshot: FeedbackComposeScreenshotState;
      sourceLabel: string;
      submitting: boolean;
      title: string;
      visibility: FeedbackComposeVisibility;
    }
  | {
      canRetry: boolean;
      deliveryState: FeedbackComposeDeliveryState;
      failure: string | null;
      hasScreenshot: boolean;
      kind: 'receipt';
      online: boolean;
      retrying: boolean;
      canSendWithoutScreenshot: boolean;
      title: string;
    }
  | { kind: 'unavailable' };

export type FeedbackComposeViewProps = {
  duplicateSuggestions: FeedbackDuplicateSuggestionsViewState;
  onBodyChange(value: string): void;
  onDiagnosticsConsentChange(value: boolean): void;
  onOpenDuplicateSuggestion(feedbackId: string): void;
  onReturn(): void;
  onRetry(): void;
  onRetryDuplicateSuggestions(): void;
  onScreenshotConsentChange(value: boolean): void;
  onScreenshotRemove(): void;
  onSendWithoutScreenshot(): void;
  onSubmit(): void;
  onTitleChange(value: string): void;
  onVisibilityChange(value: FeedbackComposeVisibility): void;
  state: FeedbackComposeViewState;
};

export function FeedbackComposeView({
  duplicateSuggestions,
  onBodyChange,
  onDiagnosticsConsentChange,
  onOpenDuplicateSuggestion,
  onReturn,
  onRetry,
  onRetryDuplicateSuggestions,
  onScreenshotConsentChange,
  onScreenshotRemove,
  onSendWithoutScreenshot,
  onSubmit,
  onTitleChange,
  onVisibilityChange,
  state,
}: FeedbackComposeViewProps) {
  const presentation = framePresentation(state);

  return (
    <ScreenFrame
      description={presentation.description}
      eyebrow="FEEDBACK"
      icon={presentation.icon}
      key={state.kind}
      liveRegion={presentation.liveRegion}
      statusLabel={presentation.statusLabel}
      testID="feedback-compose-view"
      title={presentation.title}
      tone={presentation.tone}
    >
      {state.kind === 'editing' ? (
        <EditingState
          duplicateSuggestions={duplicateSuggestions}
          onBodyChange={onBodyChange}
          onDiagnosticsConsentChange={onDiagnosticsConsentChange}
          onOpenDuplicateSuggestion={onOpenDuplicateSuggestion}
          onReturn={onReturn}
          onRetryDuplicateSuggestions={onRetryDuplicateSuggestions}
          onScreenshotConsentChange={onScreenshotConsentChange}
          onScreenshotRemove={onScreenshotRemove}
          onSubmit={onSubmit}
          onTitleChange={onTitleChange}
          onVisibilityChange={onVisibilityChange}
          state={state}
        />
      ) : null}
      {state.kind === 'receipt' ? (
        <ReceiptState
          onRetry={onRetry}
          onReturn={onReturn}
          onSendWithoutScreenshot={onSendWithoutScreenshot}
          state={state}
        />
      ) : null}
      {state.kind === 'unavailable' ? (
        <UnavailableState onReturn={onReturn} />
      ) : null}
    </ScreenFrame>
  );
}

function EditingState({
  duplicateSuggestions,
  onBodyChange,
  onDiagnosticsConsentChange,
  onOpenDuplicateSuggestion,
  onReturn,
  onRetryDuplicateSuggestions,
  onScreenshotConsentChange,
  onScreenshotRemove,
  onSubmit,
  onTitleChange,
  onVisibilityChange,
  state,
}: Pick<
  FeedbackComposeViewProps,
  | 'duplicateSuggestions'
  | 'onBodyChange'
  | 'onDiagnosticsConsentChange'
  | 'onOpenDuplicateSuggestion'
  | 'onReturn'
  | 'onRetryDuplicateSuggestions'
  | 'onScreenshotConsentChange'
  | 'onScreenshotRemove'
  | 'onSubmit'
  | 'onTitleChange'
  | 'onVisibilityChange'
> & {
  state: Extract<FeedbackComposeViewState, { kind: 'editing' }>;
}) {
  const valid = state.title.trim().length > 0 && state.body.trim().length > 0;

  return (
    <>
      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={state.online ? icons.check : icons.cloudOffline}
          />
        }
        label={
          state.online
            ? 'Bereit. Text-Feedback wird sicher gespeichert.'
            : 'Offline. Text-Feedback kann lokal gespeichert werden.'
        }
        state={state.online ? 'ready' : 'offline'}
      />
      <Card style={styles.contextCard} tone="lavender">
        <Text style={styles.overline}>AUS DIESER ANSICHT</Text>
        <Text style={styles.contextLabel}>{state.sourceLabel}</Text>
        <Text style={styles.supportCopy}>
          {state.canShareWithEvent
            ? 'Beim Teilen im Event ist die Event-Zuordnung erforderlich. Die optionale technische Kontext-Kategorie wählst du unten.'
            : 'Dieser Ansichtsname wird nicht automatisch mitgesendet. Die optionale technische Kontext-Kategorie wählst du unten.'}
        </Text>
      </Card>
      <TextField
        autoCapitalize="sentences"
        autoComplete="off"
        disabled={state.submitting}
        helpText="Kurz und konkret, höchstens 160 Zeichen."
        label="Feedback-Titel"
        maxLength={160}
        onChangeText={onTitleChange}
        placeholder="Was sollte besser werden?"
        returnKeyType="next"
        testID="feedback-compose-title"
        value={state.title}
      />
      <TextField
        autoCapitalize="sentences"
        autoComplete="off"
        disabled={state.submitting}
        helpText="Beschreibe die Idee oder das Problem. Text bleibt auch offline erhalten."
        inputStyle={styles.bodyInput}
        label="Beschreibung"
        maxLength={10_000}
        multiline
        onChangeText={onBodyChange}
        placeholder="Was ist passiert oder was wünschst du dir?"
        testID="feedback-compose-body"
        textAlignVertical="top"
        value={state.body}
      />
      <DuplicateSuggestions
        onOpen={onOpenDuplicateSuggestion}
        onRetry={onRetryDuplicateSuggestions}
        state={duplicateSuggestions}
      />
      {state.canShareWithEvent ? (
        <View accessibilityRole="radiogroup" style={styles.visibilityGroup}>
          <Text style={styles.sectionTitle}>WER SOLL ES SEHEN?</Text>
          <VisibilityChoice
            description="Aktive Mitglieder dieses Events sehen nur den bereinigten Text und Status."
            disabled={state.submitting}
            label="Im Event teilen"
            onPress={() => onVisibilityChange('event')}
            selected={state.visibility === 'event'}
            testID="feedback-visibility-event"
          />
          <VisibilityChoice
            description="Nur das Crew-Produktteam erhält dieses Feedback."
            disabled={state.submitting}
            label="Privat an Crew"
            onPress={() => onVisibilityChange('private')}
            selected={state.visibility === 'private'}
            testID="feedback-visibility-private"
          />
        </View>
      ) : (
        <Card tone="surface">
          <StatusChip label="PRIVAT AN CREW" tone="lavender" />
          <Text style={styles.supportCopy}>
            Dieses Feedback wird nicht in einem Event angezeigt.
          </Text>
        </Card>
      )}
      <ScreenshotConsent
        onChange={onScreenshotConsentChange}
        onRemove={onScreenshotRemove}
        screenshot={state.screenshot}
      />
      <DiagnosticsConsent
        consented={state.diagnosticsConsented}
        disabled={state.submitting}
        onChange={onDiagnosticsConsentChange}
        preview={state.diagnosticsPreview}
      />
      {state.error ? (
        <Text
          accessibilityLiveRegion="assertive"
          accessibilityRole="alert"
          style={styles.error}
        >
          {state.error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          accessibilityHint={submitHint(state.screenshot)}
          disabled={
            !valid ||
            state.screenshot.kind === 'loading' ||
            (state.screenshot.kind === 'preview' && state.screenshot.busy)
          }
          icon={<ScreenIcon source={icons.chat} />}
          label={submitLabel(state.screenshot)}
          loading={state.submitting}
          onPress={onSubmit}
          testID="feedback-compose-submit"
          variant="action"
        />
        <Button
          accessibilityHint="Kehrt ohne Senden exakt zur vorherigen Ansicht zurück."
          disabled={state.submitting}
          label="Zur App zurück"
          onPress={onReturn}
          testID="feedback-compose-return"
          variant="surface"
        />
      </View>
    </>
  );
}

function DuplicateSuggestions({
  onOpen,
  onRetry,
  state,
}: {
  onOpen(feedbackId: string): void;
  onRetry(): void;
  state: FeedbackDuplicateSuggestionsViewState;
}) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'searching') {
    return (
      <Card style={styles.duplicateCard} tone="lavender">
        <View style={styles.duplicateHeadingRow}>
          <StatusChip label="WIRD GEPRÜFT" tone="surface" />
          <ActivityIndicator
            accessibilityLabel="Ähnliche öffentliche Meldungen werden gesucht"
            color={colors.textSecondary}
          />
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.supportCopy}>
          Ähnliche Meldungen werden im Hintergrund geprüft. Du kannst
          weiterschreiben oder dein Feedback jederzeit senden.
        </Text>
      </Card>
    );
  }
  if (state.kind === 'skipped') {
    return (
      <Card style={styles.duplicateCard} tone="lavender">
        <StatusChip label="OFFLINE" tone="surface" />
        <Text accessibilityLiveRegion="polite" style={styles.supportCopy}>
          Ähnliche Meldungen werden gerade nicht online geprüft. Dein Feedback
          kannst du trotzdem senden.
        </Text>
      </Card>
    );
  }
  if (state.kind === 'error') {
    return (
      <Card style={styles.duplicateCard} tone="lavender">
        <StatusChip label="PRÜFUNG NICHT VERFÜGBAR" tone="surface" />
        <Text accessibilityRole="alert" style={styles.supportCopy}>
          Ähnliche Meldungen konnten nicht geprüft werden. Dein Entwurf bleibt
          erhalten und kann trotzdem gesendet werden.
        </Text>
        <Button
          label="Erneut prüfen"
          onPress={onRetry}
          testID="feedback-duplicates-retry"
          variant="surface"
        />
      </Card>
    );
  }
  return (
    <Card style={styles.duplicateCard} tone="lavender">
      <StatusChip
        label={
          state.source === 'cache'
            ? 'LETZTER ONLINE-STAND'
            : 'ÄHNLICHE MELDUNGEN'
        }
        tone="surface"
      />
      <Text accessibilityLiveRegion="polite" style={styles.supportCopy}>
        {state.source === 'cache'
          ? 'Zuletzt online gefundene öffentliche Meldungen. Beim Öffnen wird die aktuelle Verfügbarkeit geprüft.'
          : 'Das sieht ähnlich aus. Du kannst dich dort anschliessen oder deine eigene Meldung senden.'}
      </Text>
      <View style={styles.duplicateList}>
        {state.items.map(item => (
          <Pressable
            accessibilityHint="Öffnet die aktuelle öffentliche Meldung. Falls sie zusammengeführt wurde, öffnet Crew das kanonische Ziel."
            accessibilityLabel={`${item.title}. ${duplicateStatusLabel(
              item.status,
            )}. ${voteLabel(item.voteCount)}.`}
            accessibilityRole="button"
            key={item.id}
            onPress={() => onOpen(item.id)}
            style={({ pressed }) => [
              styles.duplicateChoice,
              elevations.compact,
              pressed && styles.choicePressed,
            ]}
            testID={`feedback-duplicate-${item.id}`}
          >
            <View style={styles.visibilityCopy}>
              <Text style={styles.choiceTitle}>{item.title}</Text>
              <Text style={styles.supportCopy}>
                {duplicateStatusLabel(item.status)} ·{' '}
                {voteLabel(item.voteCount)}
              </Text>
            </View>
            <ScreenIcon size={18} source={icons.caretRight} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function duplicateStatusLabel(
  status: FeedbackDuplicateSuggestion['status'],
): string {
  switch (status) {
    case 'open':
      return 'Offen';
    case 'planned':
      return 'Geplant';
    case 'in_progress':
      return 'In Umsetzung';
    case 'completed':
      return 'Umgesetzt';
    case 'declined':
      return 'Nicht geplant';
  }
}

function voteLabel(voteCount: number): string {
  return `${voteCount} ${voteCount === 1 ? 'Stimme' : 'Stimmen'}`;
}

function ScreenshotConsent({
  onChange,
  onRemove,
  screenshot,
}: {
  onChange(value: boolean): void;
  onRemove(): void;
  screenshot: FeedbackComposeScreenshotState;
}) {
  if (screenshot.kind === 'none') return null;
  if (screenshot.kind === 'loading') {
    return (
      <Card style={styles.screenshotCard} tone="lavender">
        <StatusChip label="SCREENSHOT WIRD GELADEN" tone="surface" />
        <Text accessibilityLiveRegion="polite" style={styles.supportCopy}>
          Die geschützte Vorschau wird vorbereitet. Text-Feedback bleibt
          verfügbar.
        </Text>
      </Card>
    );
  }
  if (screenshot.kind === 'unavailable') {
    return (
      <Card style={styles.screenshotCard} tone="lavender">
        <StatusChip label="SCREENSHOT NICHT VERFÜGBAR" tone="surface" />
        <Text accessibilityRole="alert" style={styles.supportCopy}>
          Es wird kein Screenshot gesendet. Dein Text bleibt vollständig
          nutzbar.
        </Text>
      </Card>
    );
  }
  return (
    <Card style={styles.screenshotCard} tone="lavender">
      <Text style={styles.sectionTitle}>OPTIONALER SCREENSHOT</Text>
      <Text style={styles.supportCopy}>
        Vorschau der vorherigen Ansicht. Sie bleibt lokal, bis du das Mitsenden
        für genau dieses Feedback auswählst.
      </Text>
      <View style={styles.screenshotPreviewFrame}>
        <Image
          accessibilityLabel="Lokale Vorschau des Screenshots aus der vorherigen Ansicht"
          resizeMode="contain"
          source={{ uri: screenshot.previewDataUri }}
          style={styles.screenshotPreview}
          testID="feedback-screenshot-preview"
        />
      </View>
      <Pressable
        accessibilityHint="Fügt genau den oben gezeigten Screenshot diesem Feedback hinzu."
        accessibilityLabel="Screenshot mitsenden"
        accessibilityRole="checkbox"
        accessibilityState={{
          checked: screenshot.consented,
          disabled: screenshot.busy,
        }}
        disabled={screenshot.busy}
        onPress={() => onChange(!screenshot.consented)}
        style={({ pressed }) => [
          styles.diagnosticsChoice,
          elevations.compact,
          screenshot.consented && styles.diagnosticsSelected,
          pressed && styles.choicePressed,
          screenshot.busy && styles.disabled,
        ]}
        testID="feedback-screenshot-consent"
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.checkbox,
            screenshot.consented && styles.checkboxSelected,
          ]}
        >
          {screenshot.consented ? (
            <ScreenIcon size={18} source={icons.check} />
          ) : null}
        </View>
        <View style={styles.visibilityCopy}>
          <Text style={styles.choiceTitle}>Screenshot mitsenden</Text>
          <Text style={styles.supportCopy}>
            Freiwillig, nur für dieses Feedback und jederzeit vor dem Senden
            entfernbar.
          </Text>
        </View>
      </Pressable>
      <Button
        disabled={screenshot.busy}
        label="Screenshot entfernen"
        onPress={onRemove}
        testID="feedback-screenshot-remove"
        variant="surface"
      />
    </Card>
  );
}

function DiagnosticsConsent({
  consented,
  disabled,
  onChange,
  preview,
}: {
  consented: boolean;
  disabled: boolean;
  onChange(value: boolean): void;
  preview: FeedbackDiagnosticsPreview | null;
}) {
  const { fontScale } = useWindowDimensions();
  const usesLargeTextLayout = fontScale >= 2;

  return (
    <Card style={styles.diagnosticsCard} tone="lavender">
      <Text style={styles.sectionTitle}>OPTIONALE DIAGNOSEDATEN</Text>
      <Text style={styles.supportCopy}>
        Diese Angaben helfen Crew bei der technischen Einordnung. Ohne deine
        Auswahl werden keine Diagnosedaten gesendet.
      </Text>
      {preview ? (
        <>
          <View
            accessible
            accessibilityLabel={`Vorschau der Diagnosedaten. App-Version ${preview.appVersion}. Build-Nummer ${preview.buildNumber}. Plattform ${preview.platform}. Kontext-Kategorie ${preview.contextCategory}.`}
            style={styles.diagnosticsPreview}
            testID="feedback-diagnostics-preview"
          >
            <DiagnosticsRow
              label="App-Version"
              usesLargeTextLayout={usesLargeTextLayout}
              value={preview.appVersion}
            />
            <DiagnosticsRow
              label="Build-Nummer"
              usesLargeTextLayout={usesLargeTextLayout}
              value={preview.buildNumber}
            />
            <DiagnosticsRow
              label="Plattform"
              usesLargeTextLayout={usesLargeTextLayout}
              value={preview.platform}
            />
            <DiagnosticsRow
              label="Kontext-Kategorie"
              usesLargeTextLayout={usesLargeTextLayout}
              value={preview.contextCategory}
            />
          </View>
          <Text style={styles.privacyCopy}>
            In diesen Diagnosedaten: keine Gerätekennung, Einladungs-Codes,
            Nachrichten, Logs oder Event-IDs.
          </Text>
          <Pressable
            accessibilityHint="Fügt genau die oben angezeigten Diagnosedaten beim Senden hinzu."
            accessibilityLabel="Diagnosedaten mitsenden"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consented, disabled }}
            disabled={disabled}
            onPress={() => onChange(!consented)}
            style={({ pressed }) => [
              styles.diagnosticsChoice,
              elevations.compact,
              consented && styles.diagnosticsSelected,
              pressed && styles.choicePressed,
              disabled && styles.disabled,
            ]}
            testID="feedback-diagnostics-consent"
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.checkbox, consented && styles.checkboxSelected]}
            >
              {consented ? <ScreenIcon size={18} source={icons.check} /> : null}
            </View>
            <View style={styles.visibilityCopy}>
              <Text style={styles.choiceTitle}>Diagnosedaten mitsenden</Text>
              <Text style={styles.supportCopy}>
                Freiwillig und nur für dieses Feedback.
              </Text>
            </View>
          </Pressable>
        </>
      ) : (
        <Text accessibilityLiveRegion="polite" style={styles.privacyCopy}>
          Diagnosedaten sind nicht verfügbar. Text-Feedback bleibt möglich.
        </Text>
      )}
    </Card>
  );
}

function DiagnosticsRow({
  label,
  usesLargeTextLayout,
  value,
}: {
  label: string;
  usesLargeTextLayout: boolean;
  value: string;
}) {
  return (
    <View
      style={[
        styles.diagnosticsRow,
        usesLargeTextLayout && styles.diagnosticsRowLargeText,
      ]}
    >
      <Text style={styles.diagnosticsLabel}>{label}</Text>
      <Text
        style={[
          styles.diagnosticsValue,
          usesLargeTextLayout && styles.diagnosticsValueLargeText,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function VisibilityChoice({
  description,
  disabled,
  label,
  onPress,
  selected,
  testID,
}: {
  description: string;
  disabled: boolean;
  label: string;
  onPress(): void;
  selected: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityHint={description}
      accessibilityLabel={`${label}. ${description}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.visibilityChoice,
        elevations.compact,
        selected && styles.visibilitySelected,
        pressed && styles.choicePressed,
        disabled && styles.disabled,
      ]}
      testID={testID}
    >
      <View style={styles.visibilityCopy}>
        <Text style={styles.choiceTitle}>{label}</Text>
        <Text style={styles.supportCopy}>{description}</Text>
      </View>
      {selected ? <StatusChip label="AUSGEWÄHLT" tone="brand" /> : null}
    </Pressable>
  );
}

function ReceiptState({
  onRetry,
  onReturn,
  onSendWithoutScreenshot,
  state,
}: {
  onRetry(): void;
  onReturn(): void;
  onSendWithoutScreenshot(): void;
  state: Extract<FeedbackComposeViewState, { kind: 'receipt' }>;
}) {
  const delivery = deliveryPresentation(state.deliveryState);
  return (
    <>
      <SyncStatus
        icon={<ScreenIcon size={17} source={delivery.icon} />}
        label={delivery.label}
        state={delivery.syncState}
      />
      <Card elevated style={styles.receiptCard} tone={delivery.tone}>
        <StatusChip label={delivery.chip} tone="surface" />
        <Text accessibilityRole="header" style={styles.receiptTitle}>
          {state.title}
        </Text>
        <Text style={styles.supportCopy}>
          {receiptDescription(delivery.description, state)}
        </Text>
        {state.failure ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {state.failure}
          </Text>
        ) : null}
        {state.deliveryState === 'sending' ? (
          <ActivityIndicator
            accessibilityLabel="Feedback wird gesendet"
            color={colors.textSecondary}
          />
        ) : null}
      </Card>
      <View style={styles.actions}>
        {state.deliveryState === 'attention' &&
        state.canSendWithoutScreenshot ? (
          <Button
            accessibilityHint="Entfernt den Screenshot aus diesem gespeicherten Feedback und setzt die Zustellung nur mit Text fort."
            label="Ohne Screenshot senden"
            loading={state.retrying}
            onPress={onSendWithoutScreenshot}
            testID="feedback-compose-send-without-screenshot"
            variant="action"
          />
        ) : null}
        {state.deliveryState === 'attention' &&
        state.canRetry &&
        !state.canSendWithoutScreenshot ? (
          <Button
            icon={<ScreenIcon source={icons.crew} />}
            label="Erneut versuchen"
            loading={state.retrying}
            onPress={onRetry}
            testID="feedback-compose-retry"
            variant="action"
          />
        ) : null}
        <Button
          accessibilityHint="Kehrt exakt zur Ansicht zurück, aus der Feedback geöffnet wurde."
          label="Zur App zurück"
          onPress={onReturn}
          testID="feedback-compose-return"
          variant={state.deliveryState === 'attention' ? 'surface' : 'action'}
        />
      </View>
    </>
  );
}

function UnavailableState({ onReturn }: { onReturn(): void }) {
  return (
    <>
      <Text accessibilityRole="alert" style={styles.error}>
        Feedback ist gerade nicht verfügbar. Es wurde nichts gespeichert.
      </Text>
      <Button
        label="Zur App zurück"
        onPress={onReturn}
        testID="feedback-compose-return"
        variant="action"
      />
    </>
  );
}

function framePresentation(state: FeedbackComposeViewState) {
  if (state.kind === 'unavailable') {
    return {
      description: 'Deine aktuelle Ansicht bleibt erhalten.',
      icon: icons.cloudOffline,
      liveRegion: 'assertive' as const,
      statusLabel: 'NICHT VERFÜGBAR',
      title: 'Feedback geben',
      tone: 'brand' as const,
    };
  }
  if (state.kind === 'receipt') {
    const delivery = deliveryPresentation(state.deliveryState);
    return {
      description: delivery.description,
      icon: delivery.icon,
      liveRegion: 'polite' as const,
      statusLabel: delivery.chip,
      title: delivery.heading,
      tone: delivery.tone,
    };
  }
  return {
    description:
      'Teile eine Idee oder ein Problem, ohne deine aktuelle Aufgabe zu verlieren.',
    icon: icons.chat,
    liveRegion: 'none' as const,
    statusLabel: 'TEXT-FEEDBACK',
    title: 'Feedback geben',
    tone: 'brand' as const,
  };
}

function deliveryPresentation(state: FeedbackComposeDeliveryState) {
  switch (state) {
    case 'pending':
      return {
        chip: 'WARTET AUF VERBINDUNG',
        description:
          'Lokal gespeichert. Die Zustellung ist noch nicht bestätigt.',
        heading: 'Feedback gespeichert',
        icon: icons.cloudOffline,
        label: 'Feedback wartet auf Verbindung.',
        syncState: 'offline' as const,
        tone: 'lavender' as const,
      };
    case 'sending':
      return {
        chip: 'WIRD GESENDET',
        description:
          'Crew sendet genau den lokal gespeicherten Text. Du kannst zur App zurückkehren; der Hintergrundversand läuft weiter.',
        heading: 'Feedback wird gesendet',
        icon: icons.crew,
        label: 'Feedback wird gesendet.',
        syncState: 'syncing' as const,
        tone: 'surface' as const,
      };
    case 'attention':
      return {
        chip: 'AKTION ERFORDERLICH',
        description:
          'Die automatische Zustellung wurde angehalten. Dein Text bleibt lokal erhalten.',
        heading: 'Feedback braucht deine Aktion',
        icon: icons.cloudOffline,
        label: 'Feedback braucht eine Aktion.',
        syncState: 'attention' as const,
        tone: 'brand' as const,
      };
    case 'delivered':
      return {
        chip: 'ZUGESTELLT',
        description: 'Die Zustellung wurde vom Server bestätigt.',
        heading: 'Feedback zugestellt',
        icon: icons.check,
        label: 'Feedback wurde zugestellt.',
        syncState: 'ready' as const,
        tone: 'action' as const,
      };
  }
}

function submitLabel(screenshot: FeedbackComposeScreenshotState): string {
  if (screenshot.kind !== 'preview') return 'Feedback senden';
  return screenshot.consented
    ? 'Feedback mit Screenshot senden'
    : 'Text ohne Screenshot senden';
}

function submitHint(screenshot: FeedbackComposeScreenshotState): string {
  if (screenshot.kind !== 'preview') {
    return 'Speichert dein Text-Feedback dauerhaft. Die aktuelle Aufgabe bleibt erhalten.';
  }
  return screenshot.consented
    ? 'Speichert Text und den gezeigten Screenshot dauerhaft für die Zustellung.'
    : 'Entfernt den Screenshot und speichert nur dein Text-Feedback dauerhaft.';
}

function receiptDescription(
  description: string,
  state: Extract<FeedbackComposeViewState, { kind: 'receipt' }>,
): string {
  if (!state.hasScreenshot) return description;
  if (state.deliveryState === 'pending') {
    return 'Text und Screenshot sind lokal gespeichert. Die Zustellung ist noch nicht bestätigt.';
  }
  if (state.deliveryState === 'sending') {
    return 'Crew sendet den gespeicherten Text und den ausgewählten Screenshot. Du kannst zur App zurückkehren.';
  }
  if (state.deliveryState === 'delivered') {
    return 'Text und Screenshot wurden vom Server bestätigt.';
  }
  return description;
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  bodyInput: {
    minHeight: 168,
  },
  choicePressed: {
    backgroundColor: colors.backgroundPressed,
    transform: [{ translateX: 1 }, { translateY: 1 }],
  },
  choiceTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  contextCard: {
    gap: spacing.xs,
  },
  contextLabel: {
    ...typography.subheading,
    color: colors.text,
  },
  diagnosticsCard: {
    gap: spacing.md,
  },
  diagnosticsChoice: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: componentMetrics.control.minimumTouchSize,
    padding: spacing.md,
  },
  diagnosticsLabel: {
    ...typography.label,
    color: colors.textSecondary,
    flexShrink: 0,
  },
  diagnosticsPreview: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.compact,
    borderWidth: borders.subtle,
    gap: spacing.sm,
    padding: spacing.md,
  },
  diagnosticsRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  diagnosticsRowLargeText: {
    flexDirection: 'column',
    gap: spacing.xxs,
  },
  diagnosticsSelected: {
    backgroundColor: colors.surfaceAction,
    borderWidth: borders.strong,
  },
  diagnosticsValue: {
    ...typography.bodyStrong,
    color: colors.text,
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },
  diagnosticsValueLargeText: {
    textAlign: 'left',
    width: '100%',
  },
  duplicateCard: {
    gap: spacing.md,
  },
  duplicateChoice: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: componentMetrics.control.minimumTouchSize,
    padding: spacing.md,
  },
  duplicateHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  duplicateList: {
    gap: spacing.sm,
  },
  disabled: {
    opacity: componentMetrics.control.disabledOpacity,
  },
  error: {
    ...typography.bodyStrong,
    color: colors.error,
  },
  overline: {
    ...typography.overline,
    color: colors.text,
  },
  privacyCopy: {
    ...typography.caption,
    color: colors.text,
  },
  checkbox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.compact,
    borderWidth: borders.chip,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  checkboxSelected: {
    backgroundColor: colors.surfaceAction,
  },
  receiptCard: {
    gap: spacing.md,
  },
  receiptTitle: {
    ...typography.heading,
    color: colors.text,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.text,
  },
  screenshotCard: {
    gap: spacing.md,
  },
  screenshotPreview: {
    flex: 1,
    width: '100%',
  },
  screenshotPreviewFrame: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.compact,
    borderWidth: borders.chip,
    height: 220,
    overflow: 'hidden',
    padding: spacing.xs,
    width: '100%',
  },
  supportCopy: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  visibilityChoice: {
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    flexDirection: 'column',
    gap: spacing.md,
    minHeight: componentMetrics.control.minimumTouchSize,
    padding: spacing.md,
  },
  visibilityCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  visibilityGroup: {
    gap: spacing.sm,
  },
  visibilitySelected: {
    backgroundColor: colors.surfaceAction,
    borderWidth: borders.strong,
  },
});
