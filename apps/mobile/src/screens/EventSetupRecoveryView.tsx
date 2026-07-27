import type { ImageSourcePropType } from 'react-native';
import {
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
import {
  isEventSetupPlaceQueryValid,
  type EventSetupCapabilityType,
  type EventSetupPlaceCandidate,
  type EventSetupPlaceEnrichment,
  type EventSetupRecoverySnapshot,
  type EventSetupTemplateId,
} from './EventSetupRecoveryRuntime';
import { eventTemplateCopy } from './EventTemplateCopy';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
  flag: require('../assets/icons/flag.png'),
  golf: require('../assets/icons/golf.png'),
  location: require('../assets/icons/location.png'),
} satisfies Record<string, ImageSourcePropType>;

export type EventSetupRecoveryAction =
  | 'adopt_template'
  | 'approve_worldwide_place'
  | 'bind_place'
  | 'bind_reviewed_place'
  | 'check_worldwide_search'
  | 'enrich_place'
  | 'open_worldwide_search'
  | 'refresh'
  | 'reject_worldwide_place'
  | 'restore_capability'
  | 'retry_enrichment'
  | 'retry_worldwide_search'
  | 'search_places'
  | 'start_worldwide_search';

export type EventSetupRecoveryViewModel = {
  busyAction: EventSetupRecoveryAction | null;
  message: string | null;
  online: boolean;
  phase: 'concealed' | 'loading' | 'ready' | 'resolved';
  placeEnrichment: EventSetupPlaceEnrichment | null;
  placeEnrichmentUnavailable: boolean;
  placeQuery: string;
  placeResults: readonly EventSetupPlaceCandidate[];
  placeSearchMiss: boolean;
  selectedPlaceId: string | null;
  selectedTemplateId: EventSetupTemplateId | null;
  snapshot: EventSetupRecoverySnapshot | null;
  worldwideCountryCode: string;
  worldwideEnrichment: EventSetupPlaceEnrichment | null;
  worldwideExpanded: boolean;
  worldwidePollingPaused: boolean;
  worldwideUnavailable: boolean;
};

export type EventSetupRecoveryViewProps = {
  model: EventSetupRecoveryViewModel;
  onBack(): void;
  onCountryCodeChange(value: string): void;
  onPlaceQueryChange(value: string): void;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
  onSelectPlace(id: string): void;
  onSelectTemplate(id: EventSetupTemplateId): void;
};

export function EventSetupRecoveryView({
  model,
  onBack,
  onCountryCodeChange,
  onPlaceQueryChange,
  onPrimaryAction,
  onSelectPlace,
  onSelectTemplate,
}: EventSetupRecoveryViewProps) {
  const presentation = framePresentation(model);

  return (
    <ScreenFrame
      description={presentation.description}
      eyebrow="EVENT-SETUP"
      icon={presentation.icon}
      key={model.phase}
      liveRegion={presentation.liveRegion}
      statusLabel={presentation.statusLabel}
      testID="event-setup-recovery-view"
      title={presentation.title}
      tone={presentation.tone}
    >
      {model.phase === 'loading' ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          Der sichere Eventstand wird geprüft.
        </Text>
      ) : null}
      {model.phase === 'concealed' ? (
        <ConcealedState
          model={model}
          onBack={onBack}
          onPrimaryAction={onPrimaryAction}
        />
      ) : null}
      {model.phase === 'resolved' && model.snapshot ? (
        <ResolvedState model={model} onBack={onBack} />
      ) : null}
      {model.phase === 'ready' && model.snapshot ? (
        <ReadyState
          model={{ ...model, snapshot: model.snapshot }}
          onBack={onBack}
          onCountryCodeChange={onCountryCodeChange}
          onPlaceQueryChange={onPlaceQueryChange}
          onPrimaryAction={onPrimaryAction}
          onSelectPlace={onSelectPlace}
          onSelectTemplate={onSelectTemplate}
        />
      ) : null}
    </ScreenFrame>
  );
}

function ConcealedState({
  model,
  onBack,
  onPrimaryAction,
}: {
  model: EventSetupRecoveryViewModel;
  onBack(): void;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
}) {
  return (
    <>
      <Text style={styles.body}>
        {model.message ??
          'Dieser private Setup-Ablauf ist für dieses Konto nicht verfügbar.'}
      </Text>
      <View style={styles.actions}>
        {model.online ? (
          <Button
            accessibilityHint="Prüft Konto, Rolle und Eventstand erneut online."
            icon={<ScreenIcon source={icons.cloudOffline} />}
            label="Erneut prüfen"
            loading={model.busyAction === 'refresh'}
            onPress={() => onPrimaryAction('refresh')}
            testID="event-setup-primary-action"
            variant="action"
          />
        ) : null}
        <Button
          accessibilityHint="Kehrt ohne Änderung zur Event-Prüfung zurück."
          label="Zurück zur Prüfung"
          disabled={Boolean(model.busyAction)}
          onPress={onBack}
          testID="event-setup-back-action"
          variant="surface"
        />
      </View>
    </>
  );
}

function ResolvedState({
  model,
  onBack,
}: {
  model: EventSetupRecoveryViewModel;
  onBack(): void;
}) {
  return (
    <>
      <Text style={styles.body}>
        {model.message ??
          (model.snapshot?.source === 'online'
            ? 'Der aktuelle Serverstand meldet diesen Prüfpunkt nicht mehr als offen.'
            : 'Die gespeicherte Prüfung meldet diesen Prüfpunkt nicht mehr als offen. Bestätige den Stand online in der Prüfung.')}
      </Text>
      <Button
        accessibilityHint="Kehrt zur Prüfung zurück und lädt dort den aktuellen Serverstand."
        icon={<ScreenIcon source={icons.arrowRight} />}
        label="Zurück zur Prüfung"
        disabled={Boolean(model.busyAction)}
        onPress={onBack}
        testID="event-setup-primary-action"
        variant="action"
      />
    </>
  );
}

function ReadyState({
  model,
  onBack,
  onCountryCodeChange,
  onPlaceQueryChange,
  onPrimaryAction,
  onSelectPlace,
  onSelectTemplate,
}: EventSetupRecoveryViewProps & {
  model: EventSetupRecoveryViewModel & {
    snapshot: EventSetupRecoverySnapshot;
  };
}) {
  const snapshot = model.snapshot;
  const authoritative = snapshot.source === 'online';
  const primary = primaryAction(model);
  return (
    <>
      <View style={styles.metaRow}>
        <StatusChip label={roleLabel(snapshot.role)} tone="surface" />
        <StatusChip label={templateLabel(snapshot.template)} tone="lavender" />
      </View>
      <SyncStatus
        icon={
          <ScreenIcon
            size={17}
            source={authoritative ? icons.check : icons.cloudOffline}
          />
        }
        label={sourceLabel(snapshot)}
        state={authoritative ? 'ready' : 'offline'}
      />

      {!authoritative ? (
        <Card accessibilityRole="alert" style={styles.notice} tone="brand">
          <Text style={styles.cardTitle}>
            {model.online
              ? 'Serverstand nicht bestätigt'
              : 'Nur sichere Offline-Kopie'}
          </Text>
          <Text style={styles.body}>
            Du kannst den zuletzt bestätigten Kontext lesen. Setup, Fähigkeit
            und Hauptort werden ohne aktuelle Serverprüfung weder vorgemerkt
            noch geändert.
          </Text>
        </Card>
      ) : null}

      {snapshot.intent.code === 'EVENT_TEMPLATE_REQUIRED' ? (
        <TemplateRecovery model={model} onSelectTemplate={onSelectTemplate} />
      ) : null}
      {snapshot.intent.code === 'EVENT_CAPABILITY_REQUIRED' ? (
        <CapabilityRecovery snapshot={snapshot} />
      ) : null}
      {snapshot.intent.code === 'EVENT_CAPABILITY_PLACE_REQUIRED' ? (
        <PlaceRecovery
          model={model}
          onCountryCodeChange={onCountryCodeChange}
          onPlaceQueryChange={onPlaceQueryChange}
          onPrimaryAction={onPrimaryAction}
          onSelectPlace={onSelectPlace}
        />
      ) : null}

      {model.message ? (
        <Card
          accessibilityLiveRegion="polite"
          style={styles.notice}
          tone="brand"
        >
          <Text style={styles.body}>{model.message}</Text>
        </Card>
      ) : null}

      <View style={styles.actions}>
        {primary ? (
          <Button
            accessibilityHint={primary.hint}
            disabled={Boolean(model.busyAction)}
            icon={<ScreenIcon source={primary.icon} />}
            label={primary.label}
            loading={model.busyAction === primary.action}
            onPress={() => onPrimaryAction(primary.action)}
            testID="event-setup-primary-action"
            variant="action"
          />
        ) : null}
        <Button
          accessibilityHint="Kehrt ohne weitere Änderung zur Event-Prüfung zurück."
          label="Zurück zur Prüfung"
          disabled={Boolean(model.busyAction)}
          onPress={onBack}
          testID="event-setup-back-action"
          variant="surface"
        />
      </View>
    </>
  );
}

function TemplateRecovery({
  model,
  onSelectTemplate,
}: {
  model: EventSetupRecoveryViewModel & {
    snapshot: EventSetupRecoverySnapshot;
  };
  onSelectTemplate(id: EventSetupTemplateId): void;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Passendes Start-Setup
      </Text>
      <Text style={styles.body}>
        Wähle die Struktur, die zu diesem privaten Event passt. Deine bereits
        eingegebenen Event-Details bleiben erhalten.
      </Text>
      <View accessibilityRole="radiogroup" style={styles.optionList}>
        {model.snapshot.templates.map(template => {
          const copy = eventTemplateCopy[template.id];
          return (
            <OptionCard
              disabled={
                Boolean(model.busyAction) || model.snapshot.source !== 'online'
              }
              icon={templateIcon(template.id)}
              key={template.id}
              label={`${copy.title}. ${copy.summary}`}
              onPress={() => onSelectTemplate(template.id)}
              selected={model.selectedTemplateId === template.id}
              subtitle={copy.summary}
              testID={`event-setup-template-${template.id}`}
              title={copy.title}
            />
          );
        })}
      </View>
      {model.snapshot.source === 'online' && model.selectedTemplateId ? (
        <Card style={styles.notice} tone="lavender">
          <Text style={styles.cardTitle}>
            Gewählt: {templateLabel(model.selectedTemplateId)}
          </Text>
          <Text style={styles.body}>
            Die bestehende Event-Basis bleibt erhalten. Neue Bausteine werden
            erst nach der versionierten Serverprüfung angelegt.
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

function CapabilityRecovery({
  snapshot,
}: {
  snapshot: EventSetupRecoverySnapshot;
}) {
  const target = snapshot.target;
  if (!target) return null;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Fehlendes Setup ergänzen
      </Text>
      <Card style={styles.capabilityCard} tone="lavender">
        <View style={styles.cardHeading}>
          <RoundIcon source={capabilityIcon(target.type)} />
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>{capabilityLabel(target.type)}</Text>
            <Text style={styles.body}>{target.eventTitle}</Text>
          </View>
        </View>
        <Text style={styles.body}>{capabilitySummary(target.type)}</Text>
      </Card>
    </View>
  );
}

function PlaceRecovery({
  model,
  onCountryCodeChange,
  onPlaceQueryChange,
  onPrimaryAction,
  onSelectPlace,
}: {
  model: EventSetupRecoveryViewModel & {
    snapshot: EventSetupRecoverySnapshot;
  };
  onCountryCodeChange(value: string): void;
  onPlaceQueryChange(value: string): void;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
  onSelectPlace(id: string): void;
}) {
  const target = model.snapshot.target;
  if (!target) return null;
  const selected = model.placeResults.find(
    result => result.id === model.selectedPlaceId,
  );
  const formLocked = worldwideFormLocked(model);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Hauptort für {capabilityLabel(target.type)}
      </Text>
      <Card style={styles.capabilityCard} tone="lavender">
        <View style={styles.cardHeading}>
          <RoundIcon source={icons.location} />
          <View style={styles.copy}>
            <Text style={styles.cardTitle}>{target.eventTitle}</Text>
            <Text style={styles.body}>
              {target.currentPlaceName ?? 'Noch kein Hauptort verbunden'}
            </Text>
          </View>
        </View>
      </Card>
      <TextField
        autoCapitalize="words"
        autoComplete="off"
        disabled={
          model.snapshot.source !== 'online' ||
          Boolean(model.busyAction) ||
          formLocked
        }
        helpText="Suche nach Ort, Golfplatz oder Veranstaltungsort."
        label="Hauptort suchen"
        maxLength={120}
        onChangeText={onPlaceQueryChange}
        onSubmitEditing={() => {
          if (isEventSetupPlaceQueryValid(model.placeQuery)) {
            onPrimaryAction('search_places');
          }
        }}
        placeholder={
          target.type === 'golf'
            ? 'Zum Beispiel: Golf Club'
            : 'Zum Beispiel: Zürich'
        }
        returnKeyType="search"
        testID="event-setup-place-query"
        value={model.placeQuery}
      />
      {model.placeResults.length > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.optionList}>
          {model.placeResults.map(result => (
            <OptionCard
              disabled={
                Boolean(model.busyAction) || model.snapshot.source !== 'online'
              }
              icon={icons.location}
              key={result.id}
              label={`${result.name}. ${placeSubtitle(result)}`}
              onPress={() => onSelectPlace(result.id)}
              selected={model.selectedPlaceId === result.id}
              subtitle={placeSubtitle(result)}
              testID={`event-setup-place-${result.id}`}
              title={result.name}
            />
          ))}
        </View>
      ) : null}
      {model.placeSearchMiss ? (
        <WorldwidePlaceRecovery
          model={model}
          onCountryCodeChange={onCountryCodeChange}
          onPrimaryAction={onPrimaryAction}
        />
      ) : null}
      {selected ? (
        <PlaceEnrichmentStatus
          model={model}
          onPrimaryAction={onPrimaryAction}
          selected={selected}
        />
      ) : null}
    </View>
  );
}

function WorldwidePlaceRecovery({
  model,
  onCountryCodeChange,
  onPrimaryAction,
}: {
  model: EventSetupRecoveryViewModel & {
    snapshot: EventSetupRecoverySnapshot;
  };
  onCountryCodeChange(value: string): void;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
}) {
  const countryCode = model.worldwideCountryCode.trim().toUpperCase();
  const countryValid = /^[A-Z]{2}$/.test(countryCode);
  const formLocked = worldwideFormLocked(model);
  return (
    <Card
      accessibilityLiveRegion="polite"
      style={styles.worldwideCard}
      testID="event-setup-worldwide"
      tone="brand"
    >
      <StatusChip label="KEIN TREFFER" tone="surface" />
      <Text style={styles.cardTitle}>Kein passender Ort gefunden.</Text>
      <Text style={styles.body}>
        Prüfe zuerst den Suchbegriff. Falls der Ort im Crew-Katalog fehlt,
        kannst du danach eine begrenzte weltweite Suche starten.
      </Text>
      {!model.worldwideExpanded ? (
        <Button
          accessibilityHint="Öffnet die optionale weltweite Suche. Das Event wird noch nicht verändert."
          disabled={Boolean(model.busyAction)}
          label="Weltweit weitersuchen"
          onPress={() => onPrimaryAction('open_worldwide_search')}
          testID="event-setup-worldwide-open"
          variant="surface"
        />
      ) : (
        <View style={styles.worldwideContent}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Weltweite Suche
          </Text>
          <Text style={styles.body}>
            Der Ländercode begrenzt die Suche. Ein Vorschlag wird nur aus
            eindeutigen Orten dieses Events übernommen und bleibt sichtbar
            prüfbar.
          </Text>
          <TextField
            autoCapitalize="characters"
            autoComplete="country"
            disabled={
              model.snapshot.source !== 'online' ||
              Boolean(model.busyAction) ||
              formLocked
            }
            error={
              countryValid
                ? undefined
                : 'Gib einen zweistelligen Ländercode wie CH oder DE ein.'
            }
            helpText={
              model.snapshot.suggestedCountryCode === countryCode
                ? 'Aus den eindeutigen Orten dieses Events vorgeschlagen.'
                : 'Zweistelliger ISO-Ländercode.'
            }
            label="Land"
            maxLength={2}
            onChangeText={onCountryCodeChange}
            placeholder="CH"
            testID="event-setup-worldwide-country"
            value={model.worldwideCountryCode}
          />
          {!model.worldwideEnrichment ? (
            <Button
              accessibilityHint="Startet eine begrenzte weltweite Suche. Vor deiner Prüfung wird kein Ort angelegt."
              disabled={
                !countryValid ||
                !isEventSetupPlaceQueryValid(model.placeQuery) ||
                !model.online ||
                Boolean(model.busyAction)
              }
              label={
                model.worldwideUnavailable
                  ? 'Weltweite Suche erneut versuchen'
                  : 'Weltweite Suche starten'
              }
              loading={model.busyAction === 'start_worldwide_search'}
              onPress={() => onPrimaryAction('start_worldwide_search')}
              testID="event-setup-worldwide-start"
              variant="surface"
            />
          ) : (
            <WorldwideEnrichmentStatus
              model={model}
              onPrimaryAction={onPrimaryAction}
            />
          )}
          {model.worldwideUnavailable ? (
            <Text accessibilityRole="alert" style={styles.body}>
              Die weltweite Suche oder Prüfung ist gerade nicht verfügbar. Dein
              Suchbegriff und das Land bleiben erhalten; es wurde kein Erfolg
              angenommen.
            </Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function WorldwideEnrichmentStatus({
  model,
  onPrimaryAction,
}: {
  model: EventSetupRecoveryViewModel;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
}) {
  const result = model.worldwideEnrichment;
  if (!result) return null;
  const status = result.enrichment.status;
  const review = result.review;
  if (status === 'pending' || status === 'processing') {
    return (
      <Card style={styles.notice} tone="lavender">
        <StatusChip label="WELTWEITE SUCHE LÄUFT" tone="lavender" />
        <Text style={styles.cardTitle}>Crew prüft passende Quellen.</Text>
        <Text style={styles.body}>
          Die Suche läuft im Hintergrund. Vor deiner Prüfung wird kein Ort
          angelegt oder verbunden.
        </Text>
        {model.worldwidePollingPaused ? (
          <Button
            accessibilityHint="Fragt den aktuellen Stand einmalig beim Gateway ab."
            disabled={!model.online || Boolean(model.busyAction)}
            label="Status erneut prüfen"
            loading={model.busyAction === 'check_worldwide_search'}
            onPress={() => onPrimaryAction('check_worldwide_search')}
            testID="event-setup-worldwide-check"
            variant="surface"
          />
        ) : null}
      </Card>
    );
  }
  if (status === 'retry') {
    return (
      <Card accessibilityRole="alert" style={styles.notice} tone="brand">
        <Text style={styles.cardTitle}>Ein neuer Versuch ist möglich.</Text>
        <Text style={styles.body}>
          Suchbegriff und Land bleiben erhalten. Es wurde kein Ort angelegt.
        </Text>
        <Button
          accessibilityHint="Startet den serverseitig erlaubten neuen Versuch für dieselbe Suche."
          disabled={!model.online || Boolean(model.busyAction)}
          label="Weltweite Suche erneut versuchen"
          loading={model.busyAction === 'retry_worldwide_search'}
          onPress={() => onPrimaryAction('retry_worldwide_search')}
          testID="event-setup-worldwide-retry"
          variant="surface"
        />
      </Card>
    );
  }
  if (status === 'failed' || status === 'dead') {
    return (
      <Card accessibilityRole="alert" style={styles.notice} tone="brand">
        <Text style={styles.cardTitle}>
          Die weltweite Suche konnte nicht abgeschlossen werden.
        </Text>
        <Text style={styles.body}>
          Es wurde kein Ort angelegt. Passe Suchbegriff oder Land an, bevor du
          einen neuen Versuch startest.
        </Text>
      </Card>
    );
  }
  if (!review) return null;
  return (
    <Card
      accessibilityLiveRegion="polite"
      style={styles.reviewCard}
      testID="event-setup-worldwide-review"
      tone={review.state === 'pending' ? 'surface' : 'action'}
    >
      <StatusChip
        label={
          review.state === 'pending'
            ? 'PRÜFUNG ERFORDERLICH'
            : review.state === 'approved'
            ? 'ORT FREIGEGEBEN'
            : 'VORSCHLAG ABGELEHNT'
        }
        tone={review.state === 'pending' ? 'lavender' : 'action'}
      />
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {review.state === 'pending'
          ? 'Prüfe den weltweiten Vorschlag.'
          : review.state === 'approved'
          ? 'Der Vorschlag ist freigegeben.'
          : 'Der Vorschlag wurde abgelehnt.'}
      </Text>
      {review.state === 'rejected' ? (
        <Text style={styles.body}>
          Es wurde kein Ort angelegt oder mit dem Event verbunden.
        </Text>
      ) : (
        <View style={styles.reviewFields}>
          {review.fields.map(field => (
            <View
              accessible
              accessibilityLabel={`${reviewFieldLabel(field.name)}: ${
                field.value
              }. Quelle: ${field.provenance.sourceUrl}`}
              key={field.name}
              style={styles.reviewField}
            >
              <Text style={styles.fieldLabel}>
                {reviewFieldLabel(field.name)}
              </Text>
              <Text style={styles.body}>{field.value}</Text>
              <Text style={styles.source}>
                Quelle: {field.provenance.sourceUrl}
              </Text>
            </View>
          ))}
        </View>
      )}
      {review.state === 'pending' && !model.worldwideUnavailable ? (
        <View style={styles.reviewActions}>
          <Button
            accessibilityHint="Gibt genau diesen geprüften Vorschlag frei und verbindet ihn danach über den bestehenden Event-Ort-Ablauf."
            disabled={!model.online || Boolean(model.busyAction)}
            label="Vorschlag freigeben"
            loading={model.busyAction === 'approve_worldwide_place'}
            onPress={() => onPrimaryAction('approve_worldwide_place')}
            testID="event-setup-worldwide-approve"
            variant="action"
          />
          <Button
            accessibilityHint="Lehnt den Vorschlag ab. Es wird kein Ort angelegt oder verbunden."
            disabled={!model.online || Boolean(model.busyAction)}
            label="Vorschlag ablehnen"
            loading={model.busyAction === 'reject_worldwide_place'}
            onPress={() => onPrimaryAction('reject_worldwide_place')}
            testID="event-setup-worldwide-reject"
            variant="surface"
          />
        </View>
      ) : null}
      {review.state === 'approved' && result.place ? (
        <Button
          accessibilityHint="Wiederholt nur das sichere Verbinden des bereits freigegebenen Orts."
          disabled={!model.online || Boolean(model.busyAction)}
          label="Freigegebenen Ort verbinden"
          loading={model.busyAction === 'bind_reviewed_place'}
          onPress={() => onPrimaryAction('bind_reviewed_place')}
          testID="event-setup-worldwide-bind"
          variant="action"
        />
      ) : null}
    </Card>
  );
}

function PlaceEnrichmentStatus({
  model,
  onPrimaryAction,
  selected,
}: {
  model: EventSetupRecoveryViewModel;
  onPrimaryAction(action: EventSetupRecoveryAction): void;
  selected: EventSetupPlaceCandidate;
}) {
  const presentation = placeEnrichmentPresentation(model, selected);
  const canRetry =
    model.placeEnrichment?.enrichment.retryAllowed === true &&
    model.online &&
    !model.placeEnrichmentUnavailable;
  return (
    <Card
      accessibilityLiveRegion="polite"
      accessibilityRole={presentation.alert ? 'alert' : undefined}
      style={styles.notice}
      tone={presentation.tone}
    >
      <StatusChip label={presentation.label} tone={presentation.chipTone} />
      <Text style={styles.cardTitle}>{presentation.title}</Text>
      <Text style={styles.body}>{presentation.body}</Text>
      {canRetry ? (
        <Button
          accessibilityHint="Startet einen neuen Versuch für die zusätzlichen Ortsdetails. Der gewählte Hauptort bleibt unverändert."
          disabled={Boolean(model.busyAction)}
          label="Ortsdetails erneut laden"
          loading={model.busyAction === 'retry_enrichment'}
          onPress={() => onPrimaryAction('retry_enrichment')}
          testID="event-setup-enrichment-retry"
          variant="surface"
        />
      ) : null}
    </Card>
  );
}

function placeEnrichmentPresentation(
  model: EventSetupRecoveryViewModel,
  selected: EventSetupPlaceCandidate,
) {
  if (model.busyAction === 'enrich_place') {
    return {
      alert: false,
      body: `Der gewählte Ort ${selected.name} bleibt unverändert. Sobald die Anfrage bestätigt ist, kannst du ihn als Hauptort übernehmen.`,
      chipTone: 'lavender' as const,
      label: 'DETAILS WERDEN ANGEFRAGT',
      title: 'Ortsdetails werden angefragt.',
      tone: 'lavender' as const,
    };
  }
  if (model.placeEnrichmentUnavailable) {
    return {
      alert: true,
      body: `Du kannst ${selected.name} trotzdem mit den bereits angezeigten Angaben als Hauptort übernehmen.`,
      chipTone: 'surface' as const,
      label: 'DETAILS NICHT VERFÜGBAR',
      title: 'Zusätzliche Ortsdetails sind gerade nicht verfügbar.',
      tone: 'brand' as const,
    };
  }
  const status = model.placeEnrichment?.enrichment.status;
  if (status === 'pending' || status === 'processing') {
    return {
      alert: false,
      body: `Name und Ort von ${selected.name} sind bereits verfügbar. Du kannst den Ort jetzt als Hauptort übernehmen.`,
      chipTone: 'lavender' as const,
      label: 'DETAILS WERDEN GELADEN',
      title: 'Ortsdetails werden ergänzt.',
      tone: 'lavender' as const,
    };
  }
  if (status === 'retry') {
    return {
      alert: true,
      body: `Der gewählte Ort ${selected.name} bleibt verfügbar. Lade die Details erneut oder übernimm ihn jetzt als Hauptort.`,
      chipTone: 'surface' as const,
      label: 'NEUER VERSUCH MÖGLICH',
      title: 'Ortsdetails brauchen einen neuen Versuch.',
      tone: 'brand' as const,
    };
  }
  if (status === 'succeeded') {
    return {
      alert: false,
      body: `Die verfügbaren Angaben zu ${selected.name} werden beim Übernehmen als Hauptort verwendet.`,
      chipTone: 'action' as const,
      label: 'DETAILS VERFÜGBAR',
      title: 'Ortsdetails sind verfügbar.',
      tone: 'action' as const,
    };
  }
  if (status === 'failed' || status === 'dead') {
    return {
      alert: true,
      body: `Du kannst ${selected.name} mit den bereits angezeigten Angaben als Hauptort übernehmen.`,
      chipTone: 'surface' as const,
      label: 'DETAILS NICHT VERFÜGBAR',
      title: 'Zusätzliche Ortsdetails konnten nicht geladen werden.',
      tone: 'brand' as const,
    };
  }
  return {
    alert: false,
    body: `Du kannst ${selected.name} mit den angezeigten Angaben als Hauptort übernehmen.`,
    chipTone: 'action' as const,
    label: 'ORT AUSGEWÄHLT',
    title: `Gewählt: ${selected.name}`,
    tone: 'action' as const,
  };
}

function OptionCard({
  disabled,
  icon,
  label,
  onPress,
  selected,
  subtitle,
  testID,
  title,
}: {
  disabled: boolean;
  icon: ImageSourcePropType;
  label: string;
  onPress(): void;
  selected: boolean;
  subtitle: string;
  testID: string;
  title: string;
}) {
  const largeText = useWindowDimensions().fontScale >= 2;
  return (
    <Pressable
      accessibilityHint="Wählt diesen Eintrag aus."
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.optionPressable}
      testID={testID}
    >
      {({ pressed }) => (
        <Card
          style={[
            styles.optionCard,
            largeText && styles.optionCardLargeText,
            selected && styles.optionSelected,
            disabled && styles.optionDisabled,
            pressed && styles.optionPressed,
            pressed && elevations.pressed,
          ]}
          testID={`${testID}-card`}
          tone={selected ? 'action' : 'surface'}
        >
          <RoundIcon source={icon} />
          <View
            style={[styles.copy, largeText && styles.copyLargeText]}
            testID={`${testID}-copy`}
          >
            <Text style={styles.optionTitle}>{title}</Text>
            <Text style={styles.body}>{subtitle}</Text>
          </View>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.radio,
              largeText && styles.radioLargeText,
              selected && styles.radioSelected,
            ]}
            testID={`${testID}-radio`}
          >
            {selected ? <View style={styles.radioDot} /> : null}
          </View>
        </Card>
      )}
    </Pressable>
  );
}

function RoundIcon({ source }: { source: ImageSourcePropType }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.roundIcon}
    >
      <Image resizeMode="contain" source={source} style={styles.iconImage} />
    </View>
  );
}

function worldwideFormLocked(model: EventSetupRecoveryViewModel): boolean {
  if (model.worldwideUnavailable) return false;
  const result = model.worldwideEnrichment;
  if (!result) return false;
  if (
    result.enrichment.status === 'pending' ||
    result.enrichment.status === 'processing'
  ) {
    return true;
  }
  return (
    result.enrichment.status === 'succeeded' &&
    result.review?.state !== 'rejected'
  );
}

function reviewFieldLabel(
  name: NonNullable<
    EventSetupPlaceEnrichment['review']
  >['fields'][number]['name'],
): string {
  if (name === 'name') return 'Name';
  if (name === 'locality') return 'Ort';
  if (name === 'region') return 'Region';
  if (name === 'countryCode') return 'Land';
  if (name === 'latitude') return 'Breitengrad';
  if (name === 'longitude') return 'Längengrad';
  if (name === 'address') return 'Adresse';
  if (name === 'websiteUrl') return 'Website';
  return 'Kurzbeschreibung';
}

function primaryAction(model: EventSetupRecoveryViewModel): {
  action: EventSetupRecoveryAction;
  hint: string;
  icon: ImageSourcePropType;
  label: string;
} | null {
  const snapshot = model.snapshot;
  if (!snapshot || !model.online || model.phase !== 'ready') return null;
  if (snapshot.source === 'cached') {
    return {
      action: 'refresh',
      hint: 'Lädt Rolle, Setup und Prüfpunkt erneut vom Gateway.',
      icon: icons.cloudOffline,
      label: 'Erneut online prüfen',
    };
  }
  if (
    snapshot.intent.code === 'EVENT_TEMPLATE_REQUIRED' &&
    model.selectedTemplateId
  ) {
    return {
      action: 'adopt_template',
      hint: 'Übernimmt das ausgewählte Setup versioniert in den bestehenden privaten Entwurf.',
      icon: icons.arrowRight,
      label: 'Setup übernehmen',
    };
  }
  if (snapshot.intent.code === 'EVENT_CAPABILITY_REQUIRED') {
    return {
      action: 'restore_capability',
      hint: 'Stellt die typisierte Fähigkeit mit der aktuellen Serverversion wieder her.',
      icon: icons.check,
      label: 'Setup ergänzen',
    };
  }
  if (snapshot.intent.code === 'EVENT_CAPABILITY_PLACE_REQUIRED') {
    if (worldwideFormLocked(model)) return null;
    if (model.selectedPlaceId) {
      return {
        action: 'bind_place',
        hint: 'Legt den ausgewählten Ort im Event an und verbindet ihn als Hauptort.',
        icon: icons.arrowRight,
        label: 'Als Hauptort übernehmen',
      };
    }
    if (isEventSetupPlaceQueryValid(model.placeQuery)) {
      return {
        action: 'search_places',
        hint: 'Sucht online nach passenden Orten, ohne das Event zu verändern.',
        icon: icons.location,
        label: 'Orte suchen',
      };
    }
  }
  return null;
}

function framePresentation(model: EventSetupRecoveryViewModel) {
  if (model.phase === 'loading') {
    return {
      description: 'Konto, Rolle und letzter Eventstand werden sicher geprüft.',
      icon: icons.cloudOffline,
      liveRegion: 'polite' as const,
      statusLabel: 'WIRD GELADEN',
      title: 'Setup wird geladen',
      tone: 'surface' as const,
    };
  }
  if (model.phase === 'concealed') {
    return {
      description: 'Dieser private Setup-Ablauf bleibt sicher verborgen.',
      icon: icons.cloudOffline,
      liveRegion: 'assertive' as const,
      statusLabel: 'NICHT VERFÜGBAR',
      title: 'Setup nicht verfügbar',
      tone: 'brand' as const,
    };
  }
  if (model.phase === 'resolved') {
    const cached = model.snapshot?.source === 'cached';
    return {
      description: model.snapshot?.eventTitle ?? 'Dein Event',
      icon: cached ? icons.cloudOffline : icons.check,
      liveRegion: 'polite' as const,
      statusLabel: cached ? 'GESPEICHERTE PRÜFUNG' : 'PRÜFPUNKT ERLEDIGT',
      title: 'Stand passt',
      tone: cached ? ('brand' as const) : ('action' as const),
    };
  }
  const code = model.snapshot?.intent.code;
  return {
    description: model.snapshot?.eventTitle ?? 'Dein Event',
    icon:
      code === 'EVENT_CAPABILITY_PLACE_REQUIRED'
        ? icons.location
        : code === 'EVENT_CAPABILITY_REQUIRED'
        ? icons.flag
        : icons.calendar,
    liveRegion: 'polite' as const,
    statusLabel:
      model.snapshot?.source === 'online' ? 'ONLINE GEPRÜFT' : 'OFFLINE-KOPIE',
    title:
      code === 'EVENT_CAPABILITY_PLACE_REQUIRED'
        ? 'Hauptort festlegen'
        : code === 'EVENT_CAPABILITY_REQUIRED'
        ? 'Setup fehlt'
        : 'Start-Setup wählen',
    tone: 'surface' as const,
  };
}

function roleLabel(role: EventSetupRecoverySnapshot['role']) {
  return role === 'owner' ? 'Eigentümer:in' : 'Organisator:in';
}

function sourceLabel(snapshot: EventSetupRecoverySnapshot) {
  if (snapshot.source === 'cached') {
    return snapshot.checkedAt
      ? 'Offline-Kopie · letzte gespeicherte Prüfung'
      : 'Offline-Kopie · Prüfpunkt online bestätigen';
  }
  return 'Aktueller Serverstand · Änderungen nur online';
}

function templateLabel(value: EventSetupTemplateId | null) {
  if (value === 'golf-tour') return 'Golfreise';
  if (value === 'team-event') return 'Team-Event';
  if (value === 'travel') return 'Reise';
  return 'Setup offen';
}

function capabilityLabel(type: EventSetupCapabilityType) {
  if (type === 'golf') return 'Golfrunde';
  if (type === 'lodging') return 'Unterkunft';
  if (type === 'team') return 'Teameinteilung';
  if (type === 'transport') return 'Transport';
  return 'Reise';
}

function capabilitySummary(type: EventSetupCapabilityType) {
  if (type === 'golf')
    return 'Stableford, Abschlag und Handicap bleiben typisiert.';
  if (type === 'lodging')
    return 'Check-in, Check-out und Zimmervergabe bleiben typisiert.';
  if (type === 'team')
    return 'Zuteilung, Kapazität und Moderation bleiben typisiert.';
  if (type === 'transport')
    return 'Treffpunkt und Anreisemodus bleiben typisiert.';
  return 'Heimatort und Reise-Referenz bleiben klar getrennt.';
}

function templateIcon(id: EventSetupTemplateId) {
  if (id === 'golf-tour') return icons.golf;
  if (id === 'team-event') return icons.crew;
  return icons.calendar;
}

function capabilityIcon(type: EventSetupCapabilityType) {
  if (type === 'golf') return icons.golf;
  if (type === 'team') return icons.crew;
  return icons.calendar;
}

function placeSubtitle(place: EventSetupPlaceCandidate) {
  return [place.locality, place.region, place.countryCode]
    .filter(Boolean)
    .join(' · ');
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  capabilityCard: {
    gap: spacing.md,
  },
  cardHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  copyLargeText: {
    alignSelf: 'stretch',
    flex: 0,
  },
  fieldLabel: {
    ...typography.overline,
    color: colors.textSecondary,
  },
  iconImage: {
    height: 24,
    width: 24,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  notice: {
    gap: spacing.sm,
  },
  optionCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 96,
    padding: spacing.lg,
  },
  optionCardLargeText: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  optionList: {
    gap: spacing.md,
  },
  optionPressable: {
    minHeight: componentMetrics.control.minimumTouchSize,
  },
  optionPressed: {
    transform: [{ translateX: spacing.xxs }, { translateY: spacing.xxs }],
  },
  optionSelected: {
    borderColor: colors.focus,
  },
  optionDisabled: {
    opacity: componentMetrics.control.disabledOpacity,
  },
  optionTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  radio: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  radioDot: {
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    height: 12,
    width: 12,
  },
  radioLargeText: {
    alignSelf: 'flex-end',
  },
  radioSelected: {
    borderColor: colors.focus,
    borderWidth: borders.strong,
  },
  reviewActions: {
    gap: spacing.md,
  },
  reviewCard: {
    gap: spacing.md,
  },
  reviewField: {
    borderColor: colors.border,
    borderTopWidth: borders.subtle,
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  reviewFields: {
    gap: spacing.md,
  },
  roundIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.control.minimumTouchSize,
    justifyContent: 'center',
    width: componentMetrics.control.minimumTouchSize,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.overline,
    color: colors.text,
  },
  source: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  worldwideCard: {
    gap: spacing.md,
  },
  worldwideContent: {
    gap: spacing.md,
  },
});
