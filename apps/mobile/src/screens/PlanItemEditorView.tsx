import type { ReactNode } from 'react';
import type { ImageSourcePropType } from 'react-native';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Card, StatusChip, TextField } from '../design/primitives';
import {
  borders,
  colors,
  elevations,
  radii,
  spacing,
  typography,
} from '../design/theme';
import type { EventSetupPlaceCandidate } from './EventSetupRecoveryRuntime';
import type { PlanItemDetails, PlanItemSnapshot } from './PlanRuntime';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const icons = {
  arrowRight: require('../assets/icons/arrow-right.png'),
  bus: require('../assets/icons/bus.png'),
  calendar: require('../assets/icons/calendar.png'),
  check: require('../assets/icons/check.png'),
  cloudOffline: require('../assets/icons/cloud-offline.png'),
  crew: require('../assets/icons/crew.png'),
  flag: require('../assets/icons/flag.png'),
  golf: require('../assets/icons/golf.png'),
  location: require('../assets/icons/location.png'),
  wine: require('../assets/icons/wine.png'),
} satisfies Record<string, ImageSourcePropType>;

export type PlanItemType = PlanItemDetails['type'];
export type PlanItemStatus = 'active' | 'archived' | 'cancelled';
export type PlanItemEditorField =
  | 'activityBookingReference'
  | 'destinationPlaceId'
  | 'endsAt'
  | 'flightDesignator'
  | 'golfRoundReference'
  | 'golfTeeTime'
  | 'lodgingCheckInAt'
  | 'lodgingCheckOutAt'
  | 'lodgingPropertyName'
  | 'mealReservationNote'
  | 'notes'
  | 'originPlaceId'
  | 'placeId'
  | 'railServiceDesignator'
  | 'roadPickupInstructions'
  | 'sessionDescendantEventId'
  | 'sessionRoom'
  | 'startsAt'
  | 'timeZone'
  | 'title';

export type PlanItemPlaceField = Extract<
  PlanItemEditorField,
  'destinationPlaceId' | 'originPlaceId' | 'placeId'
>;

export type PlanItemEditorForm = Record<PlanItemEditorField, string> & {
  allDay: boolean;
  status: PlanItemStatus;
  type: PlanItemType;
};

export type PlanItemEditorViewModel = {
  busy: boolean;
  canSubmit: boolean;
  delivery: PlanItemSnapshot['delivery'];
  dirty: boolean;
  errors: Partial<Record<PlanItemEditorField, string>>;
  eventTitle: string;
  form: PlanItemEditorForm;
  issue: 'attention' | 'conflict' | 'deleted' | 'permission' | null;
  message: string | null;
  mode: 'create' | 'edit';
  online: boolean;
  phase: 'concealed' | 'loading' | 'ready';
  placeSearch: {
    action: 'create' | 'search' | null;
    message: string | null;
    query: string;
    results: readonly EventSetupPlaceCandidate[];
    target: PlanItemPlaceField | null;
  };
  places: readonly { id: string; label: string }[];
  refreshing: boolean;
  role: 'organizer' | 'owner' | null;
  saved: boolean;
};

export type PlanItemEditorViewProps = {
  model: PlanItemEditorViewModel;
  onAllDayChange(value: boolean): void;
  onBack(): void;
  onChange(field: PlanItemEditorField, value: string): void;
  onClosePlaceSearch(): void;
  onCreatePlace(candidateId: string): void;
  onOpenPlaceSearch(target: PlanItemPlaceField): void;
  onPlaceQueryChange(value: string): void;
  onPrimaryAction(): void;
  onSearchPlaces(): void;
  onStatusChange(value: PlanItemStatus): void;
  onTypeChange(value: PlanItemType): void;
};

const typeOptions = [
  'flight',
  'rail',
  'road_transfer',
  'lodging',
  'meal',
  'golf_round',
  'session',
  'activity',
  'note',
] as const satisfies readonly PlanItemType[];

const statusOptions = [
  'active',
  'cancelled',
  'archived',
] as const satisfies readonly PlanItemStatus[];

export function PlanItemEditorView({
  model,
  onAllDayChange,
  onBack,
  onChange,
  onClosePlaceSearch,
  onCreatePlace,
  onOpenPlaceSearch,
  onPlaceQueryChange,
  onPrimaryAction,
  onSearchPlaces,
  onStatusChange,
  onTypeChange,
}: PlanItemEditorViewProps) {
  const usesLargeTextLayout = useWindowDimensions().fontScale >= 2;
  if (model.phase === 'loading') {
    return (
      <ScreenFrame
        description="Der sichere Entwurf und seine lokale Warteschlange werden geladen."
        eyebrow="PLAN-EINTRAG"
        testID="plan-item-editor-view"
        title="Editor wird geladen"
      />
    );
  }

  if (model.phase === 'concealed') {
    return (
      <ScreenFrame
        description="Dieser private Editor ist für dieses Konto oder diese Rolle nicht verfügbar."
        eyebrow="PLAN-EINTRAG"
        icon={icons.cloudOffline}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        testID="plan-item-editor-view"
        title="Editor nicht verfügbar"
        tone="brand"
      >
        {model.message ? (
          <Text style={styles.body}>{model.message}</Text>
        ) : null}
        <Button
          label="Zurück zum Plan"
          onPress={onBack}
          testID="plan-item-editor-back"
          variant="surface"
        />
      </ScreenFrame>
    );
  }

  const locked =
    model.busy ||
    model.refreshing ||
    model.saved ||
    model.placeSearch.action !== null ||
    (model.issue !== null && model.issue !== 'conflict') ||
    model.delivery === 'syncing' ||
    model.delivery === 'attention';
  const primaryIsBack = model.saved;
  return (
    <ScreenFrame
      description={model.eventTitle}
      eyebrow={
        model.mode === 'create' ? 'ZUM PLAN HINZUFÜGEN' : 'PLAN BEARBEITEN'
      }
      icon={model.issue ? icons.flag : typeIcon(model.form.type)}
      liveRegion="polite"
      statusLabel={editorStatus(model)}
      testID="plan-item-editor-view"
      title={
        model.mode === 'create' ? 'Neuer Programmpunkt' : 'Programmpunkt ändern'
      }
      tone={model.issue ? 'brand' : 'surface'}
    >
      <View style={styles.metaRow}>
        <StatusChip
          label={model.role === 'owner' ? 'Owner' : 'Organisator:in'}
          tone="lavender"
        />
        <StatusChip label={typeLabel(model.form.type)} tone="surface" />
        {!model.online ? <StatusChip label="Offline" tone="brand" /> : null}
        {model.refreshing ? (
          <StatusChip label="Serverstand wird geprüft" tone="brand" />
        ) : null}
      </View>

      {model.issue ? <IssueCard issue={model.issue} /> : null}
      {model.delivery === 'queued' || model.delivery === 'syncing' ? (
        <Card tone="action">
          <Text style={styles.cardTitle}>Lokal dauerhaft gespeichert</Text>
          <Text style={styles.body}>
            {model.delivery === 'syncing'
              ? 'Crew gleicht genau diese Änderung gerade mit dem Server ab.'
              : 'Die Änderung wartet auf Verbindung. Sie bleibt auch nach einem Neustart erhalten.'}
          </Text>
        </Card>
      ) : null}
      {model.message ? (
        <Card accessibilityLiveRegion="polite" tone="brand">
          <Text style={styles.body}>{model.message}</Text>
        </Card>
      ) : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Art des Eintrags
        </Text>
        <Text style={styles.body}>
          Die Felder darunter passen sich an. Bereits eingegebene Werte bleiben
          beim Wechsel erhalten.
        </Text>
        <View accessibilityRole="radiogroup" style={styles.optionGrid}>
          {typeOptions.map(type => (
            <ChoiceCard
              disabled={locked || model.mode === 'edit'}
              icon={typeIcon(type)}
              key={type}
              label={typeLabel(type)}
              onPress={() => onTypeChange(type)}
              selected={model.form.type === type}
              testID={`plan-item-type-${type}`}
            />
          ))}
        </View>
        {model.mode === 'edit' ? (
          <Text style={styles.help}>
            Die Art bleibt beim Bearbeiten unverändert. Lege für eine andere Art
            einen neuen Programmpunkt an.
          </Text>
        ) : null}
      </View>

      <View style={styles.form}>
        <TextField
          autoCapitalize="sentences"
          disabled={locked}
          error={model.errors.title}
          inputStyle={usesLargeTextLayout ? styles.multilineInput : undefined}
          label="Titel"
          maxLength={200}
          multiline={usesLargeTextLayout}
          onChangeText={value => onChange('title', value)}
          placeholder="Zum Beispiel: Transfer zum Hotel"
          submitBehavior="blurAndSubmit"
          testID="plan-item-title"
          textAlignVertical={usesLargeTextLayout ? 'top' : undefined}
          value={model.form.title}
        />
        <TextField
          autoCapitalize="sentences"
          disabled={locked}
          error={model.errors.notes}
          helpText="Optional. Hinweise bleiben offline verfügbar."
          inputStyle={styles.multilineInput}
          label="Hinweise"
          maxLength={20_000}
          multiline
          onChangeText={value => onChange('notes', value)}
          placeholder="Treffpunkt, Gepäck, Vorbereitung …"
          testID="plan-item-notes"
          textAlignVertical="top"
          value={model.form.notes}
        />
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Zeit und Zeitzone
        </Text>
        <View
          style={[
            styles.switchRow,
            usesLargeTextLayout && styles.switchRowLargeText,
          ]}
        >
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Ganztägig</Text>
            <Text style={styles.body}>
              Der Eintrag bleibt im Tagesplan, ohne feste Uhrzeit.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Ganztägig"
            accessibilityState={{
              checked: model.form.allDay,
              disabled: locked,
            }}
            disabled={locked}
            ios_backgroundColor={colors.surface}
            onValueChange={onAllDayChange}
            testID="plan-item-all-day"
            thumbColor={
              model.form.allDay ? colors.surfaceBrand : colors.surface
            }
            trackColor={{
              false: colors.surfaceAccent,
              true: colors.surfaceAction,
            }}
            value={model.form.allDay}
          />
        </View>
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          disabled={locked}
          error={model.errors.timeZone}
          helpText="IANA-Zeitzone, zum Beispiel Europe/Zurich"
          label="Zeitzone"
          maxLength={100}
          onChangeText={value => onChange('timeZone', value)}
          testID="plan-item-time-zone"
          value={model.form.timeZone}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          disabled={locked}
          error={model.errors.startsAt}
          helpText="JJJJ-MM-TT HH:MM in der gewählten Zeitzone"
          label="Beginn"
          maxLength={16}
          onChangeText={value => onChange('startsAt', value)}
          placeholder="2026-09-20 09:00"
          testID="plan-item-starts-at"
          value={model.form.startsAt}
        />
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          disabled={locked}
          error={model.errors.endsAt}
          helpText="Optional. Muss nach dem Beginn liegen."
          label="Ende"
          maxLength={16}
          onChangeText={value => onChange('endsAt', value)}
          placeholder="2026-09-20 10:00"
          testID="plan-item-ends-at"
          value={model.form.endsAt}
        />
      </View>

      <DetailsFields
        disabled={locked}
        errors={model.errors}
        form={model.form}
        online={model.online}
        onChange={onChange}
        onClosePlaceSearch={onClosePlaceSearch}
        onCreatePlace={onCreatePlace}
        onOpenPlaceSearch={onOpenPlaceSearch}
        onPlaceQueryChange={onPlaceQueryChange}
        onSearchPlaces={onSearchPlaces}
        placeSearch={model.placeSearch}
        places={model.places}
      />

      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Ort und Status
        </Text>
        <PlaceSelector
          disabled={locked}
          error={model.errors.placeId}
          field="placeId"
          label="Ort"
          online={model.online}
          onChange={value => onChange('placeId', value)}
          onClosePlaceSearch={onClosePlaceSearch}
          onCreatePlace={onCreatePlace}
          onOpenPlaceSearch={onOpenPlaceSearch}
          onPlaceQueryChange={onPlaceQueryChange}
          onSearchPlaces={onSearchPlaces}
          optional
          placeSearch={model.placeSearch}
          places={model.places}
          testID="plan-item-place-id"
          value={model.form.placeId}
        />
        <View accessibilityRole="radiogroup" style={styles.optionGrid}>
          {statusOptions.map(status => (
            <ChoiceCard
              disabled={locked}
              icon={status === 'active' ? icons.check : icons.flag}
              key={status}
              label={statusLabel(status)}
              onPress={() => onStatusChange(status)}
              selected={model.form.status === status}
              testID={`plan-item-status-${status}`}
            />
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          accessibilityHint={
            primaryIsBack
              ? 'Kehrt zum Plan zurück.'
              : 'Speichert genau diese Änderung dauerhaft. Online wird sie anschliessend synchronisiert.'
          }
          disabled={
            !primaryIsBack && (!model.canSubmit || !model.dirty || locked)
          }
          icon={
            <ScreenIcon
              source={primaryIsBack ? icons.arrowRight : icons.check}
            />
          }
          label={primaryIsBack ? 'Zurück zum Plan' : primaryLabel(model)}
          loading={model.busy}
          onPress={primaryIsBack ? onBack : onPrimaryAction}
          testID="plan-item-editor-primary-action"
          variant="action"
        />
        {!primaryIsBack ? (
          <Button
            disabled={model.busy}
            label="Zurück zum Plan"
            onPress={onBack}
            testID="plan-item-editor-back"
            variant="surface"
          />
        ) : null}
      </View>
    </ScreenFrame>
  );
}

function DetailsFields({
  disabled,
  errors,
  form,
  online,
  onChange,
  onClosePlaceSearch,
  onCreatePlace,
  onOpenPlaceSearch,
  onPlaceQueryChange,
  onSearchPlaces,
  placeSearch,
  places,
}: {
  disabled: boolean;
  errors: PlanItemEditorViewModel['errors'];
  form: PlanItemEditorForm;
  online: boolean;
  onChange(field: PlanItemEditorField, value: string): void;
  onClosePlaceSearch(): void;
  onCreatePlace(candidateId: string): void;
  onOpenPlaceSearch(target: PlanItemPlaceField): void;
  onPlaceQueryChange(value: string): void;
  onSearchPlaces(): void;
  placeSearch: PlanItemEditorViewModel['placeSearch'];
  places: PlanItemEditorViewModel['places'];
}) {
  const field = (
    id: PlanItemEditorField,
    label: string,
    options?: {
      helpText?: string;
      maxLength?: number;
      multiline?: boolean;
      placeholder?: string;
    },
  ) => (
    <TextField
      autoCapitalize="sentences"
      autoCorrect={false}
      disabled={disabled}
      error={errors[id]}
      helpText={options?.helpText}
      inputStyle={options?.multiline ? styles.multilineInput : undefined}
      key={id}
      label={label}
      maxLength={options?.maxLength ?? 300}
      multiline={options?.multiline}
      onChangeText={value => onChange(id, value)}
      placeholder={options?.placeholder}
      testID={`plan-item-${id}`}
      textAlignVertical={options?.multiline ? 'top' : undefined}
      value={form[id]}
    />
  );

  let fields: ReactNode[];
  if (form.type === 'activity') {
    fields = [
      field('activityBookingReference', 'Buchungsreferenz', {
        helpText: 'Optional',
      }),
    ];
  } else if (
    form.type === 'flight' ||
    form.type === 'rail' ||
    form.type === 'road_transfer'
  ) {
    fields = [
      <PlaceSelector
        disabled={disabled}
        error={errors.originPlaceId}
        field="originPlaceId"
        key="originPlaceId"
        label="Startort"
        online={online}
        onChange={value => onChange('originPlaceId', value)}
        onClosePlaceSearch={onClosePlaceSearch}
        onCreatePlace={onCreatePlace}
        onOpenPlaceSearch={onOpenPlaceSearch}
        onPlaceQueryChange={onPlaceQueryChange}
        onSearchPlaces={onSearchPlaces}
        placeSearch={placeSearch}
        places={places}
        testID="plan-item-origin-place"
        value={form.originPlaceId}
      />,
      <PlaceSelector
        disabled={disabled}
        error={errors.destinationPlaceId}
        field="destinationPlaceId"
        key="destinationPlaceId"
        label="Zielort"
        online={online}
        onChange={value => onChange('destinationPlaceId', value)}
        onClosePlaceSearch={onClosePlaceSearch}
        onCreatePlace={onCreatePlace}
        onOpenPlaceSearch={onOpenPlaceSearch}
        onPlaceQueryChange={onPlaceQueryChange}
        onSearchPlaces={onSearchPlaces}
        placeSearch={placeSearch}
        places={places}
        testID="plan-item-destination-place"
        value={form.destinationPlaceId}
      />,
      form.type === 'flight'
        ? field('flightDesignator', 'Flugnummer', {
            maxLength: 20,
            placeholder: 'LX 8174',
          })
        : form.type === 'rail'
        ? field('railServiceDesignator', 'Zug oder Verbindung', {
            maxLength: 50,
            placeholder: 'IC 5',
          })
        : field('roadPickupInstructions', 'Abholhinweise', {
            maxLength: 1_000,
            multiline: true,
            placeholder: 'Treffpunkt und Erkennungsmerkmal',
          }),
    ];
  } else if (form.type === 'lodging') {
    fields = [
      field('lodgingPropertyName', 'Unterkunft', {
        maxLength: 200,
        placeholder: 'Hotel oder Ferienwohnung',
      }),
      field('lodgingCheckInAt', 'Check-in', {
        helpText: 'JJJJ-MM-TT HH:MM in der gewählten Zeitzone',
        maxLength: 16,
        placeholder: '2026-09-20 15:00',
      }),
      field('lodgingCheckOutAt', 'Check-out', {
        helpText: 'Muss nach dem Check-in liegen',
        maxLength: 16,
        placeholder: '2026-09-22 10:00',
      }),
    ];
  } else if (form.type === 'meal') {
    fields = [
      field('mealReservationNote', 'Reservierungshinweis', {
        maxLength: 1_000,
        multiline: true,
        placeholder: 'Name der Reservation oder Treffpunkt',
      }),
    ];
  } else if (form.type === 'golf_round') {
    fields = [
      field('golfRoundReference', 'Rundenreferenz', {
        maxLength: 120,
        placeholder: 'Carya · Runde 1',
      }),
      field('golfTeeTime', 'Tee-Time', {
        helpText: 'JJJJ-MM-TT HH:MM in der gewählten Zeitzone',
        maxLength: 16,
        placeholder: '2026-09-21 08:30',
      }),
    ];
  } else if (form.type === 'session') {
    fields = [
      field('sessionRoom', 'Raum', {
        maxLength: 120,
        placeholder: 'Studio 2',
      }),
      field('sessionDescendantEventId', 'Verbundener Bereich', {
        helpText: 'Optional: ID eines untergeordneten Events',
        maxLength: 100,
        placeholder: 'evt_…',
      }),
    ];
  } else {
    fields = [];
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {typeLabel(form.type)}
      </Text>
      {fields.length > 0 ? (
        <View style={styles.form}>{fields}</View>
      ) : (
        <Card tone="lavender">
          <Text style={styles.body}>
            Für diese Art genügen Titel, Zeit, Ort und Hinweise.
          </Text>
        </Card>
      )}
    </View>
  );
}

function PlaceSelector({
  disabled,
  error,
  field,
  label,
  online,
  onChange,
  onClosePlaceSearch,
  onCreatePlace,
  onOpenPlaceSearch,
  onPlaceQueryChange,
  onSearchPlaces,
  optional = false,
  placeSearch,
  places,
  testID,
  value,
}: {
  disabled: boolean;
  error?: string;
  field: PlanItemPlaceField;
  label: string;
  online: boolean;
  onChange(value: string): void;
  onClosePlaceSearch(): void;
  onCreatePlace(candidateId: string): void;
  onOpenPlaceSearch(target: PlanItemPlaceField): void;
  onPlaceQueryChange(value: string): void;
  onSearchPlaces(): void;
  optional?: boolean;
  placeSearch: PlanItemEditorViewModel['placeSearch'];
  places: PlanItemEditorViewModel['places'];
  testID: string;
  value: string;
}) {
  const known = places.some(place => place.id === value);
  const options = [
    ...(optional ? [{ id: '', label: 'Kein Ort' }] : []),
    ...places,
    ...(value && !known
      ? [{ id: value, label: 'Bisher gespeicherter Ort' }]
      : []),
  ];
  return (
    <View style={styles.placeSelector} testID={testID}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" style={styles.optionGrid}>
        {options.map(option => (
          <ChoiceCard
            disabled={disabled}
            icon={icons.location}
            key={option.id || 'none'}
            label={option.label}
            onPress={() => onChange(option.id)}
            selected={option.id === value}
            testID={`${testID}-${option.id || 'none'}`}
          />
        ))}
      </View>
      {options.length === 0 ? (
        <Text style={styles.help}>Im Event ist noch kein Ort gespeichert.</Text>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.fieldError}
        >
          Fehler: {error}
        </Text>
      ) : (
        <Text style={styles.help}>
          {optional
            ? 'Optional. Wähle einen gespeicherten Ort oder keinen Ort.'
            : 'Wähle einen im Event gespeicherten Ort.'}
        </Text>
      )}
      <Button
        accessibilityHint="Öffnet die Suche nach gespeicherten und neuen Orten direkt in diesem Editor."
        disabled={disabled}
        label={`${label} suchen oder hinzufügen`}
        onPress={() => onOpenPlaceSearch(field)}
        testID={`${testID}-open-search`}
        variant="surface"
      />
      {placeSearch.target === field ? (
        <PlaceSearchPanel
          disabled={disabled}
          label={label}
          online={online}
          onChange={onChange}
          onClose={onClosePlaceSearch}
          onCreatePlace={onCreatePlace}
          onPlaceQueryChange={onPlaceQueryChange}
          onSearchPlaces={onSearchPlaces}
          placeSearch={placeSearch}
          places={places}
          testID={testID}
        />
      ) : null}
    </View>
  );
}

function PlaceSearchPanel({
  disabled,
  label,
  online,
  onChange,
  onClose,
  onCreatePlace,
  onPlaceQueryChange,
  onSearchPlaces,
  placeSearch,
  places,
  testID,
}: {
  disabled: boolean;
  label: string;
  online: boolean;
  onChange(value: string): void;
  onClose(): void;
  onCreatePlace(candidateId: string): void;
  onPlaceQueryChange(value: string): void;
  onSearchPlaces(): void;
  placeSearch: PlanItemEditorViewModel['placeSearch'];
  places: PlanItemEditorViewModel['places'];
  testID: string;
}) {
  const query = placeSearch.query.trim().toLocaleLowerCase('de-CH');
  const cached = query
    ? places.filter(place =>
        place.label.toLocaleLowerCase('de-CH').includes(query),
      )
    : [];
  return (
    <Card style={styles.placeSearchCard} tone="lavender">
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {label} finden
      </Text>
      <Text style={styles.body}>
        Gespeicherte Orte erscheinen sofort. Neue Orte werden erst nach deiner
        Auswahl im Event angelegt.
      </Text>
      <TextField
        autoCapitalize="words"
        autoComplete="off"
        disabled={disabled}
        helpText={
          online
            ? 'Suche nach Ort, Golfplatz oder Veranstaltungsort.'
            : 'Offline bleiben gespeicherte Orte wählbar. Neue Orte brauchen eine Verbindung.'
        }
        label={`${label} suchen`}
        maxLength={120}
        onChangeText={onPlaceQueryChange}
        onSubmitEditing={onSearchPlaces}
        placeholder="Zum Beispiel: Zürich"
        returnKeyType="search"
        testID={`${testID}-search-query`}
        value={placeSearch.query}
      />
      {cached.length > 0 ? (
        <View style={styles.placeSearchResults}>
          <Text style={styles.fieldLabel}>Im Event gespeichert</Text>
          {cached.map((place, index) => (
            <Button
              accessibilityHint="Wählt diesen bereits gespeicherten Ort aus."
              disabled={disabled}
              key={place.id}
              label={`${place.label} auswählen`}
              onPress={() => onChange(place.id)}
              testID={`${testID}-cached-result-${index}`}
              variant="surface"
            />
          ))}
        </View>
      ) : null}
      {placeSearch.results.length > 0 ? (
        <View style={styles.placeSearchResults}>
          <Text style={styles.fieldLabel}>Neue Orte</Text>
          {placeSearch.results.map((place, index) => (
            <Button
              accessibilityHint={`${placeSubtitle(
                place,
              )}. Legt diesen Ort im Event an und wählt ihn aus.`}
              disabled={disabled || !online}
              key={place.id}
              label={`${place.name} hinzufügen`}
              loading={placeSearch.action === 'create'}
              onPress={() => onCreatePlace(place.id)}
              testID={`${testID}-remote-result-${index}`}
              variant="surface"
            />
          ))}
        </View>
      ) : null}
      {placeSearch.message ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.help}
        >
          {placeSearch.message}
        </Text>
      ) : null}
      <View style={styles.placeSearchActions}>
        <Button
          disabled={
            disabled || !online || placeSearch.query.trim().length === 0
          }
          label="Neue Orte suchen"
          loading={placeSearch.action === 'search'}
          onPress={onSearchPlaces}
          testID={`${testID}-search-submit`}
          variant="action"
        />
        <Button
          disabled={Boolean(placeSearch.action)}
          label="Suche schliessen"
          onPress={onClose}
          testID={`${testID}-search-close`}
          variant="surface"
        />
      </View>
    </Card>
  );
}

function placeSubtitle(place: EventSetupPlaceCandidate) {
  return [place.locality, place.countryCode].filter(Boolean).join(', ');
}

function ChoiceCard({
  disabled,
  icon,
  label,
  onPress,
  selected,
  testID,
}: {
  disabled: boolean;
  icon: ImageSourcePropType;
  label: string;
  onPress(): void;
  selected: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.choicePressable}
      testID={testID}
    >
      {({ pressed }) => (
        <Card
          style={[
            styles.choiceCard,
            selected && styles.choiceSelected,
            pressed && styles.choicePressed,
            pressed && elevations.pressed,
            disabled && styles.disabled,
          ]}
          tone={selected ? 'action' : 'surface'}
        >
          <View style={styles.choiceIcon}>
            <ScreenIcon size={20} source={icon} />
          </View>
          <Text style={styles.choiceLabel}>{label}</Text>
        </Card>
      )}
    </Pressable>
  );
}

function IssueCard({
  issue,
}: {
  issue: NonNullable<PlanItemEditorViewModel['issue']>;
}) {
  const copy =
    issue === 'conflict'
      ? 'Ein anderer Stand liegt auf dem Server. Deine lokale Eingabe bleibt erhalten; lade den Plan neu und prüfe beide Stände.'
      : issue === 'permission'
      ? 'Deine Rolle darf diesen Programmpunkt nicht mehr ändern. Die lokale Eingabe bleibt für die sichere Rückkehr erhalten.'
      : issue === 'deleted'
      ? 'Dieser Programmpunkt wurde entfernt. Die lokale Eingabe wird nicht still verworfen.'
      : 'Diese Änderung braucht Aufmerksamkeit. Prüfe den aktuellen Planstand.';
  return (
    <Card accessibilityRole="alert" tone="brand">
      <Text style={styles.cardTitle}>Änderung nicht bestätigt</Text>
      <Text style={styles.body}>{copy}</Text>
    </Card>
  );
}

function editorStatus(model: PlanItemEditorViewModel) {
  if (model.issue) return 'Änderung prüfen';
  if (model.refreshing) return 'Serverstand wird geprüft';
  if (model.saved && model.delivery === 'clean') return 'Gespeichert';
  if (model.delivery === 'queued') return 'Lokal gespeichert';
  if (model.delivery === 'syncing') return 'Wird synchronisiert';
  if (!model.online) return 'Offline bearbeitbar';
  return model.dirty ? 'Ungespeicherte Änderungen' : 'Bereit';
}

function primaryLabel(model: PlanItemEditorViewModel) {
  if (model.mode === 'edit') return 'Änderungen speichern';
  if (
    model.form.type === 'flight' ||
    model.form.type === 'rail' ||
    model.form.type === 'road_transfer' ||
    model.form.type === 'lodging' ||
    model.form.type === 'meal'
  ) {
    return 'Reiseeintrag hinzufügen';
  }
  if (model.form.type === 'golf_round') return 'Runde hinzufügen';
  if (model.form.type === 'session' || model.form.type === 'activity') {
    return 'Agenda-Punkt hinzufügen';
  }
  return 'Zum Plan hinzufügen';
}

function statusLabel(status: PlanItemStatus) {
  if (status === 'cancelled') return 'Abgesagt';
  if (status === 'archived') return 'Archiviert';
  return 'Aktiv';
}

export function typeLabel(type: PlanItemType) {
  if (type === 'flight') return 'Flug';
  if (type === 'rail') return 'Bahn';
  if (type === 'road_transfer') return 'Transfer';
  if (type === 'lodging') return 'Unterkunft';
  if (type === 'meal') return 'Essen';
  if (type === 'golf_round') return 'Golfrunde';
  if (type === 'session') return 'Session';
  if (type === 'activity') return 'Aktivität';
  return 'Notiz';
}

function typeIcon(type: PlanItemType) {
  if (type === 'flight' || type === 'rail' || type === 'road_transfer') {
    return icons.bus;
  }
  if (type === 'lodging') return icons.location;
  if (type === 'meal') return icons.wine;
  if (type === 'golf_round') return icons.golf;
  if (type === 'session' || type === 'activity') return icons.crew;
  return icons.calendar;
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  cardTitle: {
    ...typography.subheading,
    color: colors.text,
  },
  choiceCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  choiceIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceBrand,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  choiceLabel: {
    ...typography.label,
    color: colors.text,
    flexShrink: 1,
  },
  choicePressable: {
    borderRadius: radii.card,
    flexGrow: 1,
    maxWidth: '100%',
    minWidth: 144,
  },
  choicePressed: {
    backgroundColor: colors.backgroundPressed,
  },
  choiceSelected: {
    backgroundColor: colors.surfaceAction,
  },
  disabled: {
    opacity: 0.42,
  },
  flex: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  fieldError: {
    ...typography.caption,
    color: colors.error,
  },
  fieldLabel: {
    ...typography.label,
    color: colors.text,
  },
  form: {
    gap: spacing.lg,
  },
  help: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  multilineInput: {
    minHeight: 112,
  },
  optionGrid: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  placeSelector: {
    gap: spacing.sm,
  },
  placeSearchActions: {
    gap: spacing.sm,
  },
  placeSearchCard: {
    gap: spacing.md,
  },
  placeSearchResults: {
    gap: spacing.sm,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    ...typography.heading,
    color: colors.text,
  },
  switchRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAccent,
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: borders.strong,
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 72,
    padding: spacing.lg,
  },
  switchRowLargeText: {
    alignItems: 'flex-start',
    flexDirection: 'column',
  },
});
