import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import type { PrivateNavigationStatus } from '../app/PrivateBootstrapGate';
import { EmailIdentityScreen } from '../screens/EmailIdentityScreen';
import { EventBasicsScreen } from '../screens/EventBasicsScreen';
import { EventCreateScreen } from '../screens/EventCreateScreen';
import { EventHubScreen } from '../screens/EventHubScreen';
import { EventPublishScreen } from '../screens/EventPublishScreen';
import { EventSetupRecoveryScreen } from '../screens/EventSetupRecoveryScreen';
import { EventsScreen } from '../screens/EventsScreen';
import {
  CommunityFeedbackItemRouteScreen,
  CommunityFeedbackListRouteScreen,
  FeedbackComposeRouteScreen,
} from '../screens/FeedbackRoutes';
import { GolfScorecardRouteScreen } from '../screens/GolfScorecardScreen';
import { InboundGateScreen } from '../screens/InboundGateScreen';
import { InviteEditorScreen } from '../screens/InviteEditorScreen';
import { InviteManagerScreen } from '../screens/InviteManagerScreen';
import { InvitePreviewScreen } from '../screens/InvitePreviewScreen';
import { LiveItemScreen } from '../screens/LiveItemScreen';
import { NativeE2EEvidenceRouteScreen } from '../screens/NativeE2EEvidenceScreen';
import { PlanItemEditorRouteScreen } from '../screens/PlanItemEditorScreen';
import { PlanRouteScreen } from '../screens/PlanScreen';
import { RecapScreen } from '../screens/RecapScreen';
import {
  PrivateLoadingScreen,
  PrivateUnavailableScreen,
  SessionRequiredScreen,
} from '../screens/PrivateAccessScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { TeamDecisionScreen } from '../screens/TeamDecisionScreen';
import { TeamFeedScreen } from '../screens/TeamFeedScreen';
import { TeamSetupScreen } from '../screens/TeamSetupScreen';
import { UnavailableScreen } from '../screens/UnavailableScreen';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

type RootNavigatorProps = {
  privateStatus: PrivateNavigationStatus;
};

function LiveItemRouteScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'LiveItem'>) {
  const { itemId, rootEventId } = route.params;
  return (
    <LiveItemScreen
      itemId={itemId}
      onBack={() => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('Plan', { rootEventId });
      }}
      onEdit={target => navigation.navigate('PlanItemEditor', target)}
      onOpenGolfScorecard={target =>
        navigation.navigate('GolfScorecard', target)
      }
      onPrimaryAction={target => {
        if (target.kind === 'item') {
          navigation.replace('LiveItem', target);
        } else if (target.kind === 'recap') {
          navigation.navigate('RecapInbound', {
            rootEventId: target.rootEventId,
          });
        } else {
          navigation.replace('Plan', { rootEventId: target.rootEventId });
        }
      }}
      rootEventId={rootEventId}
    />
  );
}

export function RootNavigator({ privateStatus }: RootNavigatorProps) {
  const PrivateFallback =
    privateStatus === 'loading'
      ? PrivateLoadingScreen
      : privateStatus === 'unavailable'
      ? PrivateUnavailableScreen
      : SessionRequiredScreen;

  return (
    <Stack.Navigator initialRouteName="Events">
      <Stack.Screen
        name="Events"
        component={privateStatus === 'ready' ? EventsScreen : PrivateFallback}
        options={{ headerShown: false, title: 'Events' }}
      />
      <Stack.Screen
        name="CreateEvent"
        component={
          privateStatus === 'ready' ? EventCreateScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Event erstellen' }}
      />
      <Stack.Screen
        name="EventBasicsEdit"
        component={
          privateStatus === 'ready' ? EventBasicsScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Event-Details' }}
      />
      <Stack.Screen
        name="EventInbound"
        component={privateStatus === 'ready' ? EventHubScreen : PrivateFallback}
        options={{ headerShown: false, title: 'Event' }}
      />
      <Stack.Screen
        name="EventPublish"
        component={
          privateStatus === 'ready' ? EventPublishScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Event prüfen' }}
      />
      <Stack.Screen
        name="EventSetupRecovery"
        component={
          privateStatus === 'ready' ? EventSetupRecoveryScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Event-Setup' }}
      />
      <Stack.Screen
        name="Plan"
        component={privateStatus === 'ready' ? PlanRouteScreen : PrivateFallback}
        options={{ headerShown: false, title: 'Plan' }}
      />
      <Stack.Screen
        name="PlanItemEditor"
        component={
          privateStatus === 'ready'
            ? PlanItemEditorRouteScreen
            : PrivateFallback
        }
        options={{ headerShown: false, title: 'Planeintrag' }}
      />
      <Stack.Screen
        name="LiveItem"
        component={
          privateStatus === 'ready' ? LiveItemRouteScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Programmpunkt' }}
      />
      <Stack.Screen
        name="ItemInbound"
        component={
          privateStatus === 'ready' ? InboundGateScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Programmpunkt' }}
      />
      <Stack.Screen
        name="FeedInbound"
        component={
          privateStatus === 'ready' ? InboundGateScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Feed' }}
      />
      <Stack.Screen
        name="FeedbackInbound"
        component={
          privateStatus === 'ready' ? InboundGateScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Feedback' }}
      />
      <Stack.Screen
        name="FeedbackCompose"
        component={
          privateStatus === 'ready'
            ? FeedbackComposeRouteScreen
            : PrivateFallback
        }
        options={{ headerShown: false, title: 'Feedback geben' }}
      />
      <Stack.Screen
        name="CommunityFeedbackList"
        component={
          privateStatus === 'ready'
            ? CommunityFeedbackListRouteScreen
            : PrivateFallback
        }
        options={{ headerShown: false, title: 'Feedback im Event' }}
      />
      <Stack.Screen
        name="CommunityFeedbackItem"
        component={
          privateStatus === 'ready'
            ? CommunityFeedbackItemRouteScreen
            : PrivateFallback
        }
        options={{ headerShown: false, title: 'Feedback' }}
      />
      <Stack.Screen
        name="RecapInbound"
        component={privateStatus === 'ready' ? RecapScreen : PrivateFallback}
        options={{ headerShown: false, title: 'Rückblick' }}
      />
      <Stack.Screen
        name="GolfScorecard"
        component={
          privateStatus === 'ready' ? GolfScorecardRouteScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Golf Scorekarte' }}
      />
      <Stack.Screen
        name="TeamFeed"
        component={privateStatus === 'ready' ? TeamFeedScreen : PrivateFallback}
        options={{ headerShown: false, title: 'Team-Feed' }}
      />
      <Stack.Screen
        name="NativeE2EEvidence"
        component={
          privateStatus === 'ready'
            ? NativeE2EEvidenceRouteScreen
            : PrivateFallback
        }
        options={{ headerShown: false, title: 'Sync-Beweis' }}
      />
      <Stack.Screen
        name="TeamSetup"
        component={
          privateStatus === 'ready' ? TeamSetupScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Teams einteilen' }}
      />
      <Stack.Screen
        name="Decision"
        component={
          privateStatus === 'ready' ? TeamDecisionScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Entscheidung' }}
      />
      <Stack.Screen
        name="Invites"
        component={
          privateStatus === 'ready' ? InviteManagerScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Einladungen' }}
      />
      <Stack.Screen
        name="InviteEditor"
        component={
          privateStatus === 'ready' ? InviteEditorScreen : PrivateFallback
        }
        options={{ headerShown: false, title: 'Einladung erstellen' }}
      />
      <Stack.Screen
        name="InvitePreview"
        component={InvitePreviewScreen}
        options={{ headerShown: false, title: 'Einladung' }}
      />
      <Stack.Screen
        name="SignIn"
        component={SignInScreen}
        options={{ headerShown: false, title: 'Anmelden' }}
      />
      <Stack.Screen
        name="EmailIdentity"
        component={EmailIdentityScreen}
        options={{ headerShown: false, title: 'Anmelden' }}
      />
      <Stack.Screen
        name="Unavailable"
        component={UnavailableScreen}
        options={{ headerShown: false, title: 'Nicht verfügbar' }}
      />
    </Stack.Navigator>
  );
}
