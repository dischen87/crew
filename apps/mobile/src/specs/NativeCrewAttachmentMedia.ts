import { TurboModuleRegistry, type TurboModule } from 'react-native';

export type NativeRetainedAttachment = {
  retainedFileKey: string;
  contentType: string;
  byteCount: number;
  sha256: string;
  pixelWidth: number;
  pixelHeight: number;
  wasNormalized: boolean;
};

export type NativeUploadField = {
  name: string;
  value: string;
};

export interface Spec extends TurboModule {
  pickImageAndRetain(
    accountUserId: string,
  ): Promise<NativeRetainedAttachment | null>;
  cancelPending(accountUserId: string): Promise<void>;
  captureCurrentScreen(
    accountUserId: string,
  ): Promise<NativeRetainedAttachment>;
  previewRetained(
    accountUserId: string,
    retainedFileKey: string,
  ): Promise<string>;
  uploadRetained(
    accountUserId: string,
    retainedFileKey: string,
    grantUrl: string,
    grantFields: ReadonlyArray<NativeUploadField>,
    contentType: string,
    byteCount: number,
    sha256: string,
  ): Promise<void>;
  purgeRetained(
    accountUserId: string,
    retainedFileKeys: ReadonlyArray<string>,
  ): Promise<void>;
  reconcileRetained(
    accountUserId: string,
    retainedFileKeys: ReadonlyArray<string>,
  ): Promise<void>;
  normalizeAndRetain(
    accountUserId: string,
    sourceUri: string,
  ): Promise<NativeRetainedAttachment>;
}

export default TurboModuleRegistry.get<Spec>('CrewAttachmentMedia');
