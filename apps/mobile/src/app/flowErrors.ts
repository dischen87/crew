import { GatewayClientError } from '@crew/mobile-client';

const terminalPendingCodes = new Set([
  'MAGIC_LINK_INVALID',
  'INVITATION_INVALID',
  'INVITATION_UNAVAILABLE',
  'NOT_FOUND',
]);

const sessionFailureCodes = new Set([
  'SESSION_REVOKED',
  'UNAUTHENTICATED',
  'refresh_failed',
  'session_changed',
  'unauthenticated',
]);

export function isTerminalPendingError(error: unknown): boolean {
  return (
    error instanceof GatewayClientError && terminalPendingCodes.has(error.code)
  );
}

export function isSessionFailure(error: unknown): boolean {
  return (
    error instanceof GatewayClientError && sessionFailureCodes.has(error.code)
  );
}

export function isInvitationEmailMismatch(error: unknown): boolean {
  return (
    error instanceof GatewayClientError &&
    error.code === 'INVITATION_EMAIL_MISMATCH'
  );
}
