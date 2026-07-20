import React, { useState } from 'react';
import { Alert, AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  EventHubView,
  turkeyGolfEventHubModel,
} from '../src/screens/EventHubView';

function EventHubEvidenceApp() {
  const [selectedTab, setSelectedTab] = useState('plan');

  return (
    <SafeAreaProvider>
      <EventHubView
        model={turkeyGolfEventHubModel}
        onDateSelect={dateId => Alert.alert('Datum', dateId)}
        onPrimaryAction={action => Alert.alert(action.label)}
        onSyncStatusPress={() =>
          Alert.alert(turkeyGolfEventHubModel.sync.label)
        }
        onTabSelect={setSelectedTab}
        onTimelineSelect={itemId => Alert.alert('Programmpunkt', itemId)}
        selectedTab={selectedTab}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => EventHubEvidenceApp);
