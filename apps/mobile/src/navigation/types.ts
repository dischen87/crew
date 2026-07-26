export type RootStackParamList = {
  Events: undefined;
  CreateEvent: undefined;
  EventBasicsEdit: {
    rootEventId: string;
    focusField?: 'description' | 'endsAt' | 'startsAt' | 'timeZone' | 'title';
  };
  EventInbound: { rootEventId: string; focusItemId?: string };
  EventPublish: { rootEventId: string };
  EventSetupRecovery: {
    blocker:
      | 'EVENT_CAPABILITY_PLACE_REQUIRED'
      | 'EVENT_CAPABILITY_REQUIRED'
      | 'EVENT_TEMPLATE_REQUIRED';
    capabilityType?: 'golf' | 'lodging' | 'team' | 'transport' | 'travel';
    eventId?: string;
    rootEventId: string;
  };
  ItemInbound: { rootEventId: string; itemId: string };
  FeedInbound: { rootEventId: string; entryId: string };
  FeedbackInbound: { feedbackId: string };
  FeedbackCompose: {
    rootEventId?: string | null;
    eventId?: string | null;
    feedbackId?: string | null;
    screenKey: string;
    sourceLabel: string;
  };
  CommunityFeedbackList: { rootEventId: string };
  CommunityFeedbackItem: { rootEventId: string; feedbackId: string };
  RecapInbound: { rootEventId: string; version?: string };
  GolfScorecard: { rootEventId: string; eventId: string };
  TeamFeed: {
    rootEventId: string;
    eventId?: string | null;
    focusEntryId?: string;
  };
  NativeE2EEvidence: { rootEventId: string };
  TeamSetup: { rootEventId: string; eventId: string };
  Decision: { rootEventId: string; decisionId: string };
  Invites: { rootEventId: string };
  InviteEditor: { rootEventId: string };
  InvitePreview: { handle: string; autoRedeem?: boolean };
  SignIn: undefined;
  EmailIdentity: { handle: string };
  Unavailable: { reason?: string } | undefined;
};
