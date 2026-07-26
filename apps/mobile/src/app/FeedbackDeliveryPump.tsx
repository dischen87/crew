import {
  FeedbackSubmissionAccountChangedError,
  FeedbackSubmissionAuthenticationError,
  FeedbackSubmissionController,
  type FeedbackSubmissionReceipt,
} from '@crew/mobile-data';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import {
  createFeedbackAttachmentUploadTransport,
  runAttachmentMediaOperation,
} from '../media/attachmentMedia';
import { secureUuidV4 } from '../storage/secureRandom';
import { useGatewayClient } from './GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from './PrivateBootstrapGate';

export function FeedbackDeliveryPump() {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(lifecycle.accountId);
  const reloadFlightRef = useRef<Promise<void> | null>(null);
  activeAccountRef.current = lifecycle.accountId;

  const controller = useMemo(
    () =>
      new FeedbackSubmissionController(privateDatabase.database, client, {
        activeAccountUserId: () => activeAccountRef.current,
        attachmentUploadTransport: createFeedbackAttachmentUploadTransport(),
        randomUUID: secureUuidV4,
      }),
    [client, privateDatabase.database],
  );

  useEffect(() => {
    let cancelled = false;
    let dueTimer: ReturnType<typeof setTimeout> | null = null;
    const accountUserId = privateDatabase.accountId;
    const clearDueTimer = () => {
      if (dueTimer === null) return;
      clearTimeout(dueTimer);
      dueTimer = null;
    };
    const scheduleNext = (receipts: readonly FeedbackSubmissionReceipt[]) => {
      if (cancelled || !onlineManager.isOnline() || !focusManager.isFocused()) {
        return;
      }
      clearDueTimer();
      const dueAt = receipts.reduce<number | null>((earliest, receipt) => {
        const candidate = Date.parse(receipt.nextAttemptAt ?? '');
        return Number.isFinite(candidate) &&
          (earliest === null || candidate < earliest)
          ? candidate
          : earliest;
      }, null);
      if (dueAt === null) return;
      dueTimer = setTimeout(() => {
        dueTimer = null;
        drain();
      }, Math.max(0, dueAt - Date.now()));
    };
    const reload = () => {
      if (cancelled || reloadFlightRef.current) return;
      const flight = lifecycle.reloadSession().finally(() => {
        if (reloadFlightRef.current === flight) reloadFlightRef.current = null;
      });
      reloadFlightRef.current = flight;
    };
    const drain = (resume = false) => {
      if (
        cancelled ||
        !client ||
        !onlineManager.isOnline() ||
        !focusManager.isFocused()
      ) {
        return;
      }
      clearDueTimer();
      const delivery = runAttachmentMediaOperation(accountUserId, () =>
        resume
          ? controller.resumeAndDrain(accountUserId)
          : controller.drain(accountUserId),
      );
      delivery.then(scheduleNext).catch(error => {
        if (
          error instanceof FeedbackSubmissionAccountChangedError ||
          error instanceof FeedbackSubmissionAuthenticationError
        ) {
          reload();
        }
      });
    };

    drain();
    const unsubscribeOnline = onlineManager.subscribe(online => {
      if (online) drain(true);
      else clearDueTimer();
    });
    const unsubscribeFocus = focusManager.subscribe(focused => {
      if (focused) drain();
      else clearDueTimer();
    });
    return () => {
      cancelled = true;
      clearDueTimer();
      unsubscribeOnline();
      unsubscribeFocus();
    };
  }, [client, controller, lifecycle, privateDatabase.accountId]);

  return null;
}
