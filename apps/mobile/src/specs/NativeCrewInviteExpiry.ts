import { TurboModuleRegistry, type TurboModule } from 'react-native';

export type NativeInviteExpirySelection = {
  expiresAt: string;
  timeZone: string;
};

export interface Spec extends TurboModule {
  pickExpiry(
    initialExpiresAt: string,
    minimumExpiresAt: string,
  ): Promise<NativeInviteExpirySelection | null>;
}

export default TurboModuleRegistry.get<Spec>('CrewInviteExpiry');
