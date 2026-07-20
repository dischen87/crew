import { GatewayClient } from '@crew/mobile-client';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
} from 'react';
import { secureSessionStore } from '../storage/secureSession';
import {
  gatewayBaseUrlForRuntime,
  nativeE2ERequestIdForRuntime,
  runtimeFeedbackDiagnostics,
  type RuntimeBuildMetadata,
} from './runtimeConfig';

export type MobileGatewayClient = Pick<
  GatewayClient,
  'assertSessionSubject' | 'request' | 'requestAsUser' | 'sessionSubject'
>;

// Production must inject an explicitly approved HTTPS client. There is no
// guessed release host; an unconfigured release stays network-fail-closed.
export function createDefaultGatewayClient(
  isDevelopment: boolean,
  runtimeConfig?: unknown,
) {
  const baseUrl = gatewayBaseUrlForRuntime(isDevelopment, runtimeConfig);
  const nativeE2ERequestId = nativeE2ERequestIdForRuntime(
    isDevelopment,
    runtimeConfig,
  );
  return baseUrl
    ? new GatewayClient({
        baseUrl,
        sessionStore: secureSessionStore,
        ...(nativeE2ERequestId ? { requestId: () => nativeE2ERequestId } : {}),
      })
    : null;
}

const GatewayContext = createContext<MobileGatewayClient | null>(null);
const NativeE2ERequestIdContext = createContext<string | null>(null);
const RuntimeDiagnosticsContext = createContext<RuntimeBuildMetadata | null>(
  null,
);

type GatewayProviderProps = PropsWithChildren<{
  client?: MobileGatewayClient | null;
  runtimeConfig?: unknown;
}>;

export function GatewayProvider({
  children,
  client,
  runtimeConfig,
}: GatewayProviderProps) {
  const defaultClient = useMemo(
    () => createDefaultGatewayClient(__DEV__, runtimeConfig),
    [runtimeConfig],
  );
  const diagnostics = useMemo(
    () => runtimeFeedbackDiagnostics(runtimeConfig),
    [runtimeConfig],
  );
  const nativeE2ERequestId = useMemo(
    () => nativeE2ERequestIdForRuntime(__DEV__, runtimeConfig),
    [runtimeConfig],
  );
  return (
    <GatewayContext.Provider
      value={client === undefined ? defaultClient : client}
    >
      <NativeE2ERequestIdContext.Provider value={nativeE2ERequestId}>
        <RuntimeDiagnosticsContext.Provider value={diagnostics}>
          {children}
        </RuntimeDiagnosticsContext.Provider>
      </NativeE2ERequestIdContext.Provider>
    </GatewayContext.Provider>
  );
}

export function useGatewayClient(): MobileGatewayClient | null {
  return useContext(GatewayContext);
}

export function useNativeE2ERequestId(): string | null {
  return useContext(NativeE2ERequestIdContext);
}

/** Only pass this allow-listed metadata after an explicit feedback opt-in. */
export function useRuntimeFeedbackDiagnostics(): RuntimeBuildMetadata | null {
  return useContext(RuntimeDiagnosticsContext);
}
