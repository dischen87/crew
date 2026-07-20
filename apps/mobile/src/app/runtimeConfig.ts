import type { FeedbackSubmissionDiagnostics } from '@crew/mobile-data';

export type RuntimeBuildMetadata = Required<
  Pick<FeedbackSubmissionDiagnostics, 'appVersion' | 'buildNumber' | 'platform'>
>;

const developmentGatewayBaseUrl = 'http://127.0.0.1:3000';
const appVersionPattern = /^\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.-]{1,32}){0,2}$/;
const buildNumberPattern = /^\d+(?:\.\d+){0,3}$/;
const nativeE2ERequestIdPattern = /^crew-e2e\.(ios|android)$/;

export function gatewayBaseUrlForRuntime(
  isDevelopment: boolean,
  value: unknown,
): string | null {
  if (isDevelopment) return developmentGatewayBaseUrl;
  if (!isRecord(value)) return null;
  try {
    return approvedHttpsOrigin(value.gatewayBaseUrl);
  } catch {
    return null;
  }
}

export function runtimeBuildMetadata(
  value: unknown,
): RuntimeBuildMetadata | null {
  if (!isRecord(value)) return null;
  try {
    const { appVersion, buildNumber, platform } = value;
    if (
      !boundedMatch(appVersion, 64, appVersionPattern) ||
      !boundedMatch(buildNumber, 32, buildNumberPattern) ||
      (platform !== 'ios' && platform !== 'android')
    ) {
      return null;
    }
    return { appVersion, buildNumber, platform };
  } catch {
    return null;
  }
}

export function runtimeFeedbackDiagnostics(
  value: unknown,
): RuntimeBuildMetadata | null {
  return runtimeBuildMetadata(value);
}

export function nativeE2ERequestIdForRuntime(
  isDevelopment: boolean,
  value: unknown,
): string | null {
  if (!isDevelopment || !isRecord(value)) return null;
  try {
    const requestId = value.nativeE2ERequestId;
    if (typeof requestId !== 'string') return null;
    const match = nativeE2ERequestIdPattern.exec(requestId);
    return match && match[1] === value.platform ? requestId : null;
  } catch {
    return null;
  }
}

function approvedHttpsOrigin(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    value !== value.trim()
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      !isLoopback(hostname) &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.origin === value
      ? value
      : null;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function boundedMatch(
  value: unknown,
  maxLength: number,
  pattern: RegExp,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim() &&
    pattern.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
