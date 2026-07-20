import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRuntimeFeedbackDiagnostics } from '../app/GatewayProvider';
import type { RootStackParamList } from '../navigation/types';
import { CommunityFeedbackItemScreen } from './CommunityFeedbackItemScreen';
import { CommunityFeedbackListScreen } from './CommunityFeedbackListScreen';
import { FeedbackComposeScreen } from './FeedbackComposeScreen';

type ComposeProps = NativeStackScreenProps<
  RootStackParamList,
  'FeedbackCompose'
>;
type ListProps = NativeStackScreenProps<
  RootStackParamList,
  'CommunityFeedbackList'
>;
type ItemProps = NativeStackScreenProps<
  RootStackParamList,
  'CommunityFeedbackItem'
>;

export function FeedbackComposeRouteScreen({
  navigation,
  route,
}: ComposeProps) {
  const source = route.params;
  const rootEventId = source.rootEventId;
  const availableDiagnostics = useRuntimeFeedbackDiagnostics();
  return (
    <FeedbackComposeScreen
      availableDiagnostics={availableDiagnostics}
      {...(rootEventId
        ? {
            onOpenDuplicateSuggestion: (feedbackId: string) =>
              navigation.navigate('CommunityFeedbackItem', {
                feedbackId,
                rootEventId,
              }),
          }
        : {})}
      onReturn={() => returnFromCompose(navigation, source.rootEventId)}
      source={source}
    />
  );
}

export function CommunityFeedbackListRouteScreen({
  navigation,
  route,
}: ListProps) {
  const rootEventId = route.params.rootEventId;
  return (
    <CommunityFeedbackListScreen
      onBack={() => returnToEvent(navigation, rootEventId)}
      onCompose={() =>
        navigation.navigate('FeedbackCompose', {
          eventId: rootEventId,
          rootEventId,
          screenKey: 'community-feedback/list',
          sourceLabel: 'Event · Feedback',
        })
      }
      onComposeWithScreenshot={feedbackId =>
        navigation.navigate('FeedbackCompose', {
          eventId: rootEventId,
          feedbackId,
          rootEventId,
          screenKey: 'community-feedback/list',
          sourceLabel: 'Event · Feedback',
        })
      }
      onOpenFeedback={feedbackId =>
        navigation.navigate('CommunityFeedbackItem', {
          feedbackId,
          rootEventId,
        })
      }
      rootEventId={rootEventId}
    />
  );
}

export function CommunityFeedbackItemRouteScreen({
  navigation,
  route,
}: ItemProps) {
  const { feedbackId, rootEventId } = route.params;
  return (
    <CommunityFeedbackItemScreen
      feedbackId={feedbackId}
      onBack={() => returnToFeedbackList(navigation, rootEventId)}
      onCanonicalFeedback={canonicalFeedbackId =>
        navigation.replace('CommunityFeedbackItem', {
          feedbackId: canonicalFeedbackId,
          rootEventId,
        })
      }
      rootEventId={rootEventId}
    />
  );
}

function returnFromCompose(
  navigation: ComposeProps['navigation'],
  rootEventId?: string | null,
) {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else if (rootEventId) {
    navigation.navigate('EventInbound', { rootEventId });
  } else {
    navigation.navigate('Events');
  }
}

function returnToEvent(
  navigation: ListProps['navigation'],
  rootEventId: string,
) {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else {
    navigation.navigate('EventInbound', { rootEventId });
  }
}

function returnToFeedbackList(
  navigation: ItemProps['navigation'],
  rootEventId: string,
) {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else {
    navigation.navigate('CommunityFeedbackList', { rootEventId });
  }
}
