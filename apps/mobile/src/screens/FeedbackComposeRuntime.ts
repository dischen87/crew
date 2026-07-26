import {
  FeedbackDuplicateSuggestionController,
  FeedbackScreenshotStore,
  FeedbackSubmissionAccountChangedError,
  FeedbackSubmissionController,
  LocalAttachmentStore,
  type FeedbackSubmissionReceipt,
  type SqlDatabase,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import {
  captureCurrentScreenAttachment,
  createFeedbackAttachmentUploadTransport,
  previewRetainedAttachment,
  reconcileRetainedAttachmentFiles,
  runAttachmentMediaOperation,
} from '../media/attachmentMedia';
import { secureUuidV4 } from '../storage/secureRandom';

const feedbackPattern = /^fbk_[A-Za-z0-9._:-]{1,96}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const uuidV4Pattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export type FeedbackComposeScreenshot = {
  attachmentId: string;
  feedbackId: string;
  pixelHeight: number;
  pixelWidth: number;
  previewDataUri: string;
};

export type FeedbackComposeRuntimeOptions = {
  accountUserId: string;
  activeAccountUserId(): string | null | Promise<string | null>;
  client: MobileGatewayClient | null;
  database: SqlDatabase;
  now?: () => Date;
  randomUUID?: () => string;
};

export class FeedbackComposeRuntime {
  readonly controller: FeedbackSubmissionController;
  readonly duplicateSuggestions: FeedbackDuplicateSuggestionController;
  readonly #accountUserId: string;
  readonly #activeAccountUserId: FeedbackComposeRuntimeOptions['activeAccountUserId'];
  readonly #attachments: LocalAttachmentStore;
  readonly #now: () => Date;
  readonly #randomUUID: () => string;
  readonly #screenshots: FeedbackScreenshotStore;

  constructor(options: FeedbackComposeRuntimeOptions) {
    this.#accountUserId = options.accountUserId;
    this.#activeAccountUserId = options.activeAccountUserId;
    this.#attachments = new LocalAttachmentStore(options.database);
    this.#now = options.now ?? (() => new Date());
    this.#randomUUID = options.randomUUID ?? secureUuidV4;
    this.#screenshots = new FeedbackScreenshotStore(options.database);
    this.controller = new FeedbackSubmissionController(
      options.database,
      options.client,
      {
        activeAccountUserId: options.activeAccountUserId,
        attachmentUploadTransport: createFeedbackAttachmentUploadTransport(),
        randomUUID: this.#randomUUID,
      },
    );
    this.duplicateSuggestions = new FeedbackDuplicateSuggestionController(
      options.database,
      options.client,
      {
        activeAccountUserId: options.activeAccountUserId,
        now: this.#now,
      },
    );
  }

  /**
   * Call only from the explicit source-screen screenshot action. Navigation
   * carries the returned feedbackId, never the preview or retained file key.
   */
  async capture(rootEventId: string): Promise<FeedbackComposeScreenshot> {
    if (!rootPattern.test(rootEventId)) {
      throw new TypeError('Invalid feedback screenshot root');
    }
    await this.#assertActive();
    const feedbackUuid = this.#randomUUID();
    const attachmentUuid = this.#randomUUID();
    if (
      !uuidV4Pattern.test(feedbackUuid) ||
      !uuidV4Pattern.test(attachmentUuid)
    ) {
      throw new TypeError('Invalid feedback screenshot identity');
    }
    const feedbackId = `fbk_${feedbackUuid}`;
    const attachmentId = `att_${attachmentUuid}`;
    return runAttachmentMediaOperation(this.#accountUserId, async () => {
      try {
        const captured = await captureCurrentScreenAttachment(
          this.#accountUserId,
        );
        await this.#assertActive();
        const previewDataUri = await previewRetainedAttachment(
          this.#accountUserId,
          captured.retainedFileKey,
        );
        await this.#assertActive();
        await this.#screenshots.retain({
          accountUserId: this.#accountUserId,
          attachmentId,
          byteCount: captured.byteCount,
          contentType: 'image/png',
          feedbackId,
          pixelHeight: captured.pixelHeight,
          pixelWidth: captured.pixelWidth,
          retainedAt: this.#now().toISOString(),
          retainedFileKey: captured.retainedFileKey,
          rootEventId,
          sha256: captured.sha256,
          wasNormalized: true,
        });
        await this.#assertActive();
        return {
          attachmentId,
          feedbackId,
          pixelHeight: captured.pixelHeight,
          pixelWidth: captured.pixelWidth,
          previewDataUri,
        };
      } catch (error) {
        await this.#discardAndReconcile(feedbackId);
        throw error;
      }
    });
  }

  async restore(
    feedbackId: string,
    rootEventId: string,
  ): Promise<FeedbackComposeScreenshot | null> {
    if (!feedbackPattern.test(feedbackId) || !rootPattern.test(rootEventId)) {
      return null;
    }
    await this.#assertActive();
    const screenshot = await this.#screenshots.get(
      this.#accountUserId,
      feedbackId,
    );
    await this.#assertActive();
    if (!screenshot || screenshot.rootEventId !== rootEventId) return null;
    if (screenshot.state !== 'retained') return null;
    try {
      const previewDataUri = await previewRetainedAttachment(
        this.#accountUserId,
        screenshot.retainedFileKey,
      );
      await this.#assertActive();
      return {
        attachmentId: screenshot.attachmentId,
        feedbackId,
        pixelHeight: screenshot.pixelHeight,
        pixelWidth: screenshot.pixelWidth,
        previewDataUri,
      };
    } catch (error) {
      await this.#discardAndReconcile(feedbackId);
      throw error;
    }
  }

  async discard(feedbackId: string): Promise<void> {
    await this.#assertActive();
    await this.#screenshots.discard(this.#accountUserId, feedbackId);
    await reconcileRetainedAttachmentFiles(
      this.#attachments,
      this.#accountUserId,
    ).catch(() => undefined);
    await this.#assertActive();
  }

  async cleanup(feedbackId: string): Promise<void> {
    await this.#discardAndReconcile(feedbackId);
  }

  async canSendWithoutScreenshot(feedbackId: string): Promise<boolean> {
    await this.#assertActive();
    const screenshot = await this.#screenshots.get(
      this.#accountUserId,
      feedbackId,
    );
    await this.#assertActive();
    return Boolean(
      screenshot?.state === 'attention' &&
        screenshot.feedbackSendStartedAt === null,
    );
  }

  async sendWithoutScreenshot(
    feedbackId: string,
  ): Promise<FeedbackSubmissionReceipt> {
    await this.#assertActive();
    const receipt = await this.controller.sendWithoutScreenshot(
      this.#accountUserId,
      feedbackId,
    );
    await this.#assertActive();
    await reconcileRetainedAttachmentFiles(
      this.#attachments,
      this.#accountUserId,
    ).catch(() => undefined);
    await this.#assertActive();
    return receipt;
  }

  async #assertActive(): Promise<void> {
    if ((await this.#activeAccountUserId()) !== this.#accountUserId) {
      throw new FeedbackSubmissionAccountChangedError();
    }
  }

  async #discardAndReconcile(feedbackId: string): Promise<void> {
    try {
      await this.#screenshots.discard(this.#accountUserId, feedbackId);
    } catch {
      // A submitted screenshot is already durable and must not be discarded.
    }
    await reconcileRetainedAttachmentFiles(
      this.#attachments,
      this.#accountUserId,
    ).catch(() => undefined);
  }
}
