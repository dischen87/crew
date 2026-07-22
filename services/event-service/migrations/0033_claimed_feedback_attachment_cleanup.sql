CREATE FUNCTION delete_claimed_feedback_attachment(
  p_upload_id TEXT,
  p_root_event_id TEXT,
  p_attachment_id TEXT,
  p_object_key TEXT,
  p_worker_id TEXT,
  p_fence BIGINT
)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $body$
  WITH removed AS (
    DELETE FROM public.event_attachments AS attachment
    USING public.event_attachment_uploads AS upload,
      public.event_attachment_cleanup_jobs AS job
    WHERE upload.id = p_upload_id
      AND upload.root_event_id = p_root_event_id
      AND upload.attachment_id = p_attachment_id
      AND upload.target_type = 'feedback'
      AND upload.state = 'committed'
      AND job.upload_id = upload.id
      AND job.status = 'processing'
      AND job.lease_owner = p_worker_id
      AND job.fence = p_fence
      AND job.lease_until > clock_timestamp()
      AND attachment.upload_id = upload.id
      AND attachment.root_event_id = upload.root_event_id
      AND attachment.id = upload.attachment_id
      AND attachment.target_type = 'feedback'
      AND attachment.target_feedback_id = upload.target_feedback_id
      AND attachment.created_by = upload.created_by
      AND attachment.object_key = p_object_key
      AND NOT EXISTS (
        SELECT 1
        FROM public.event_feedback_attachments AS link
        WHERE link.root_event_id = attachment.root_event_id
          AND link.attachment_id = attachment.id
      )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM removed);
$body$;

REVOKE ALL ON FUNCTION delete_claimed_feedback_attachment(
  TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
) FROM PUBLIC;
