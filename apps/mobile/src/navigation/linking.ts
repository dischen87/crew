import { Linking } from 'react-native';
import type { LinkingOptions } from '@react-navigation/native';
import { CREW_WEB_URL } from '@crew/shared';
import {
  keychainPendingRouteStore,
  type PendingRouteStore,
} from '../storage/pendingRoute';
import { keychainPendingAuthReturnStore } from '../storage/pendingAuthReturn';
import type { RootStackParamList } from './types';

const MAX_URL_LENGTH = 2_048;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const AUTH_TOKEN_PATTERN = /^ml_[A-Za-z0-9_-]{43}$/;
const SCHEME_PREFIX = 'crewnext://';
const HTTPS_PREFIX = `${CREW_WEB_URL}/`;
const INVALID_LINK = 'crewnext://unavailable?reason=invalid_link';
const ROOT_EVENT_ID_PATTERN = /^evt_[A-Za-z0-9._:-]{1,96}$/;

export async function sanitizeInboundUrl(
  value: string | null,
  store: PendingRouteStore,
  allowSecretScheme = __DEV__,
): Promise<string | null> {
  if (!value) return null;
  const customScheme = value.startsWith(SCHEME_PREFIX);
  const canonicalHttps = value.startsWith(HTTPS_PREFIX);
  if (
    value.length > MAX_URL_LENGTH ||
    (!customScheme && !canonicalHttps) ||
    hasUnsafeCharacters(value)
  ) {
    return INVALID_LINK;
  }

  let url: URL;
  try {
    // Hermes' URL implementation does not expose host/path for custom schemes.
    // Parse the exact same authority/path through a well-supported HTTPS base,
    // then return only the original Crew URL after validation.
    url = new URL(
      customScheme
        ? `https://${value.slice(SCHEME_PREFIX.length)}`
        : value,
    );
  } catch {
    return INVALID_LINK;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (!customScheme && url.origin !== CREW_WEB_URL)
  ) {
    return INVALID_LINK;
  }

  const segments = [
    ...(customScheme ? [url.hostname] : []),
    ...url.pathname.split('/').filter(Boolean),
  ];
  const inviteToken =
    segments[0] === 'join' && segments.length === 2 ? segments[1] : null;
  const authToken =
    segments[0] === 'auth' && segments[1] === 'redeem' && segments.length === 2
      ? url.searchParams.get('token')
      : null;
  const secret = inviteToken ?? authToken;
  const nativeE2E = url.hostname.toLowerCase().replace(/\.+$/, '') === 'e2e';

  if (nativeE2E) {
    const rootEventId =
      segments.length === 3 &&
      segments[1] === 'outbox' &&
      ROOT_EVENT_ID_PATTERN.test(segments[2] ?? '')
        ? segments[2]
        : null;
    return allowSecretScheme &&
      rootEventId !== null &&
      value === `crewnext://e2e/outbox/${rootEventId}`
      ? value
      : INVALID_LINK;
  }

  if ((segments[0] === 'join' || segments[0] === 'auth') && secret === null) {
    return INVALID_LINK;
  }

  if (secret !== null) {
    if (customScheme && !allowSecretScheme) return INVALID_LINK;
    const queryKeys = Array.from(url.searchParams.keys());
    const validSecretShape = inviteToken
      ? url.search === ''
      : queryKeys.length === 1 && queryKeys[0] === 'token';
    const validSecret = inviteToken
      ? INVITE_TOKEN_PATTERN.test(secret)
      : AUTH_TOKEN_PATTERN.test(secret);
    if (url.hash || !validSecretShape || !validSecret) {
      return INVALID_LINK;
    }
    const kind = inviteToken ? 'invite' : 'auth';
    const handle = await store.put({
      kind,
      token: secret,
      createdAt: Date.now(),
    });
    return `crewnext://inbound/${kind}/${handle}`;
  }

  for (const key of url.searchParams.keys()) {
    if (/token|secret|code/i.test(key)) {
      return INVALID_LINK;
    }
  }
  if (url.hash) return INVALID_LINK;
  return value;
}

function hasUnsafeCharacters(value: string) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '\\' || code <= 31 || code === 127) return true;
  }
  return false;
}

export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [SCHEME_PREFIX, CREW_WEB_URL],
  config: {
    initialRouteName: 'Events',
    screens: {
      Events: 'events',
      EventBasicsEdit: 'events/:rootEventId/edit-basics/:focusField?',
      EventInbound: 'events/:rootEventId',
      EventPublish: 'events/:rootEventId/review',
      EventSetupRecovery: 'events/:rootEventId/recover/:blocker',
      ItemInbound: 'events/:rootEventId/items/:itemId',
      FeedInbound: 'events/:rootEventId/feed/:entryId',
      FeedbackInbound: 'feedback/:feedbackId',
      CommunityFeedbackList: 'events/:rootEventId/feedback',
      CommunityFeedbackItem: 'events/:rootEventId/feedback/:feedbackId',
      RecapInbound: 'events/:rootEventId/recap/:version?',
      NativeE2EEvidence: 'e2e/outbox/:rootEventId',
      TeamSetup: 'events/:rootEventId/team/:eventId',
      Decision: 'events/:rootEventId/decisions/:decisionId',
      InvitePreview: 'inbound/invite/:handle',
      SignIn: 'sign-in',
      EmailIdentity: 'inbound/auth/:handle',
      Unavailable: 'unavailable',
    },
  },
  getInitialURL: async () => {
    try {
      const inboundUrl = await Linking.getInitialURL();
      if (inboundUrl) {
        return await sanitizeInboundUrl(inboundUrl, keychainPendingRouteStore);
      }
      const authHandle = await keychainPendingRouteStore.current('auth');
      if (authHandle) return `crewnext://inbound/auth/${authHandle}`;
      const inviteHandle =
        (await keychainPendingAuthReturnStore.peek()) ??
        (await keychainPendingRouteStore.current('invite'));
      return inviteHandle ? `crewnext://inbound/invite/${inviteHandle}` : null;
    } catch {
      return INVALID_LINK;
    }
  },
  subscribe(listener) {
    const subscription = Linking.addEventListener('url', event => {
      sanitizeInboundUrl(event.url, keychainPendingRouteStore).then(
        url => {
          if (url) listener(url);
        },
        () => listener(INVALID_LINK),
      );
    });
    return () => subscription.remove();
  },
};
