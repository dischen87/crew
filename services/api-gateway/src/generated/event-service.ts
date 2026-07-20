/**
 * Generated from contracts/event-service.openapi.json.
 * Pin: sha256:b09563d2cdcd9e76981f9dcdf4b50b24be80ac07350db0a4fd198268e89fab66
 * Generator: openapi-typescript 7.13.0. Do not edit.
 */
export type paths = {
    "/v1/event-roots": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List root events with an active membership for the caller */
        get: operations["eventRootsList"];
        put?: never;
        /** Create a root event and owner membership */
        post: operations["eventsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the visible recursive event graph */
        get: operations["eventsTreeGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/attachments/{attachmentId}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["eventAttachmentsDownload"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/attachments/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["eventAttachmentUploadsPrepare"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/attachments/uploads/{uploadId}/finalize": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["eventAttachmentUploadsFinalize"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a descendant event */
        post: operations["eventChildrenCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events/{eventId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read one visible event */
        get: operations["eventsGet"];
        put?: never;
        post?: never;
        /** Tombstone an event or its full subtree */
        delete: operations["eventsDelete"];
        options?: never;
        head?: never;
        /** Update event editable state; root publish uses its command */
        patch: operations["eventsUpdate"];
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events/{eventId}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Archive an event without removing descendants */
        post: operations["eventsArchive"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events/{eventId}/capabilities/{capabilityType}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Create, restore or atomically replace a typed capability */
        put: operations["eventCapabilitiesReplace"];
        post?: never;
        /** Tombstone a capability when no live itinerary depends on it */
        delete: operations["eventCapabilitiesRemove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events/{eventId}/children/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Replace one parent's authoritative child order */
        post: operations["eventChildrenReorder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events/{eventId}/itinerary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List one visible event's ordered itinerary */
        get: operations["eventItineraryItemsList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events/{eventId}/itinerary/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Replace one event's authoritative itinerary order */
        post: operations["eventItineraryItemsReorder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/events/{eventId}/reparent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move an event below another event in the same root */
        post: operations["eventsReparent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the root feed in descending creation-revision order */
        get: operations["eventFeedEntriesList"];
        put?: never;
        post: operations["eventFeedEntriesCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feed/{entryId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["eventFeedEntriesGet"];
        put?: never;
        post?: never;
        delete: operations["eventFeedEntriesRemove"];
        options?: never;
        head?: never;
        patch: operations["eventFeedEntriesRevise"];
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feed/{entryId}/reaction": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["eventFeedReactionsSet"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List canonical public feedback for one active root member */
        get: operations["eventFeedbackList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feedback/{feedbackId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a sanitized canonical community feedback item */
        get: operations["eventFeedbackGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feedback/{feedbackId}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["eventFeedbackCommentsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feedback/{feedbackId}/follow": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["eventFeedbackFollowsSet"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feedback/{feedbackId}/vote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["eventFeedbackVotesSet"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Find likely canonical public feedback duplicates
         * @description Uses a simple deterministic Unicode token match, not semantic similarity. Returns only minimal canonical suggestion fields for an active root member. The API Gateway applies its authenticated-principal rate limit.
         */
        get: operations["eventFeedbackDuplicateSuggestionsList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/feedback/updates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List canonical public feedback status updates */
        get: operations["eventFeedbackUpdatesList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List sanitized invitation administration state */
        get: operations["eventInvitationsList"];
        put?: never;
        /** Create a hashed invitation; the deterministic token is returned only here or on exact replay */
        post: operations["eventInvitationsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/invitations/{invitationId}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke an invitation */
        post: operations["eventInvitationsRevoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/itinerary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an ordered itinerary item and immutable place snapshot */
        post: operations["eventItineraryItemsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/itinerary/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update an itinerary item using its observed version */
        patch: operations["eventItineraryItemsUpdate"];
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/member-directory-source": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Return one authorized page of active member IDs for Gateway composition */
        get: operations["eventMemberDirectorySourceGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/memberships": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List memberships visible to the caller */
        get: operations["eventMembershipsList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/memberships/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Change a non-owner membership */
        patch: operations["eventMembershipsUpdate"];
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/ownership/transfer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Transfer the single active owner role */
        post: operations["eventOwnershipTransfer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/places": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List live root-scoped places */
        get: operations["eventPlacesList"];
        put?: never;
        /** Create a root-scoped place */
        post: operations["eventPlacesCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/places/{placeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update a place without rewriting existing itinerary snapshots */
        patch: operations["eventPlacesUpdate"];
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish a ready draft root atomically
         * @description The server locks the aggregate, compares both versions and recomputes readiness before changing status.
         */
        post: operations["eventsPublish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/publish-readiness": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the authoritative versioned root publish checklist
         * @description Owner and organizer clients render these finite reason codes and must not derive readiness locally.
         */
        get: operations["eventPublishReadinessGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/recap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read one currently authorized immutable recap projection
         * @description Managers may read non-removed versions; participants and viewers receive only the current published version. Every source is revalidated before content is returned.
         */
        get: operations["eventRecapsGet"];
        put?: never;
        post?: never;
        /**
         * Tombstone all currently generated recap versions
         * @description Removal revokes every generated version through the current head while retaining immutable audit rows internally.
         */
        delete: operations["eventRecapsRemove"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/recap/external-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Grant or withdraw one exact external recap body field
         * @description Appends one exact recap-version, source-version and body-field decision. Event bodies require manager authority; feed bodies require separate source-author and manager decisions. No source content is copied into the decision record.
         */
        post: operations["eventRecapExternalGrantsDecide"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/recap/external-share-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a reviewed exact-field external recap link
         * @description After all exact body fields have current source-author and manager grants, creates one seven-day link bound to those immutable field identities and rotates every prior active recap link. Identifiable media remains unavailable.
         */
        post: operations["eventRecapExternalShareLinksCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/recap/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate an immutable recap draft from authoritative sources
         * @description The server copies bounded exact published source fields. Client-authored recap text and provider generation are not accepted by this operation.
         */
        post: operations["eventRecapsGenerate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/recap/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish the latest privacy-revalidated recap snapshot
         * @description Publication compares the recap lifecycle version and revalidates every exact source version, visibility and consent boundary in one transaction.
         */
        post: operations["eventRecapsPublish"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/recap/share-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create or rotate the bounded external recap share link
         * @description After the manager reviews the exact title-only projection, creates one seven-day link for the requested current published recap version and atomically revokes every prior active link. The opaque token is returned only in this response or an authorized exact replay.
         */
        post: operations["eventRecapShareLinksCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/recap/share-links/{shareLinkId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke one external recap share link
         * @description Revocation is immediate and idempotent for the identified link. Unknown resources remain concealed.
         */
        delete: operations["eventRecapShareLinksRevoke"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-roots/{rootEventId}/template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Adopt one supported template on an existing draft root
         * @description The server locks the aggregate and caller-stable template IDs, compares both versions, preserves existing content and expands the template atomically.
         */
        post: operations["eventTemplateAdopt"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/event-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List deterministic built-in event templates */
        get: operations["eventTemplatesList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/feedback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create durable product or event feedback
         * @description PostgreSQL is authoritative. Optional analytics delivery, including PostHog, must never create or mutate feedback state.
         */
        post: operations["feedbackCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/feedback/{feedbackId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read feedback with votes, comments and status history */
        get: operations["feedbackGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/feedback/{feedbackId}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["feedbackCommentsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/feedback/{feedbackId}/duplicate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["feedbackDuplicateMark"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/feedback/{feedbackId}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["feedbackStatusSet"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/feedback/{feedbackId}/vote": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["feedbackVotesSet"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invitations/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Read safe invitation branding without authentication */
        post: operations["eventInvitationsPreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invitations/redeem": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redeem an invitation as the authenticated user */
        post: operations["eventInvitationsRedeem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/places/enrichment-jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Select a candidate or request bounded no-match enrichment
         * @description Persists an idempotent background job and returns immediately without provider work in the request path.
         */
        post: operations["placeEnrichmentJobsCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/places/enrichment-jobs/{jobId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read safe place-enrichment progress and approved facts */
        get: operations["placeEnrichmentJobsGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/places/enrichment-jobs/{jobId}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Advance an existing bounded automatic retry
         * @description Never resets attempts or provider budgets; terminal failures require manual recovery.
         */
        post: operations["placeEnrichmentJobsRetry"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/places/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search pending and enriched first-party place records */
        get: operations["placesSearch"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recap-external-share-links/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resolve one reviewed exact-field external recap token
         * @description Returns only the public recap title, event item titles and explicitly selected body fields while the exact link, recap, sources, author grants, manager grants and authority memberships remain current. It never returns identities, membership, provenance, internal IDs, media or tokens. Every invalid state is the same concealed 404.
         */
        post: operations["eventRecapExternalShareLinksResolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/recap-share-links/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Resolve one opaque external recap share token
         * @description Returns a redacted exact published recap while the link, root, creator authority, title, sources, consent and removal policy remain valid. Malformed, unknown, revoked, rotated, expired and concealed links share one response.
         */
        post: operations["eventRecapShareLinksResolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sync/bootstrap": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read an immutable point-in-time root snapshot */
        get: operations["syncBootstrapRead"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sync/pull": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read visible root changes after a signed checkpoint */
        get: operations["syncChangesList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sync/push": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Apply one bounded root mutation stream batch */
        post: operations["syncMutationsApply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: {
        AttachmentTarget: {
            entryId: string;
            /** @enum {string} */
            kind: "feedEntry";
        } | {
            feedbackId: string;
            /** @enum {string} */
            kind: "feedback";
        };
        AttachmentUploadPrepare: {
            attachmentId: string;
            byteCount: number;
            /** @enum {string} */
            contentType: "image/jpeg" | "image/png" | "image/webp";
            sha256: string;
            targetEntryId: string;
        } | {
            attachmentId: string;
            byteCount: number;
            /** @enum {string} */
            contentType: "image/jpeg" | "image/png" | "image/webp";
            sha256: string;
            target: components["schemas"]["AttachmentTarget"];
        };
        CommunityFeedbackComment: {
            body: string;
            /** Format: date-time */
            createdAt: string;
            id: string;
        };
        CommunityFeedbackDetail: {
            body: string;
            commentCount: number;
            comments: components["schemas"]["CommunityFeedbackComment"][];
            commentsHasMore: boolean;
            /** Format: date-time */
            createdAt: string;
            duplicateCount: number;
            followed: boolean;
            id: string;
            /** @enum {string} */
            status: "open" | "planned" | "in_progress" | "completed" | "declined";
            statusHistory: components["schemas"]["CommunityFeedbackStatusChange"][];
            statusHistoryCount: number;
            statusHistoryHasMore: boolean;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
            viewerHasVoted: boolean;
            /** @description Unique authenticated voters across the canonical item and its current duplicates. */
            voteCount: number;
        };
        CommunityFeedbackDuplicateSuggestion: {
            id: string;
            /** @enum {string} */
            status: "open" | "planned" | "in_progress" | "completed" | "declined";
            title: string;
            voteCount: number;
        };
        CommunityFeedbackStatusChange: {
            /** Format: date-time */
            changedAt: string;
            fromStatus: ("open" | "planned" | "in_progress" | "completed" | "declined") | null;
            note: string | null;
            /** @enum {string} */
            toStatus: "open" | "planned" | "in_progress" | "completed" | "declined";
            version: number;
        };
        CommunityFeedbackSummary: {
            body: string;
            /** Format: date-time */
            createdAt: string;
            duplicateCount: number;
            followed: boolean;
            id: string;
            /** @enum {string} */
            status: "open" | "planned" | "in_progress" | "completed" | "declined";
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
            viewerHasVoted: boolean;
            /** @description Unique authenticated voters across the canonical item and its current duplicates. */
            voteCount: number;
        };
        CommunityFeedbackUpdate: {
            /** Format: date-time */
            changedAt: string;
            feedbackId: string;
            /** @enum {string} */
            fromStatus: "open" | "planned" | "in_progress" | "completed" | "declined";
            note: string | null;
            title: string;
            /** @enum {string} */
            toStatus: "open" | "planned" | "in_progress" | "completed" | "declined";
            version: number;
        };
        EnrichedPlace: {
            address: string | null;
            countryCode: string;
            id: string;
            /** @enum {string} */
            kind: "golf_course" | "venue";
            latitude: number | null;
            locality: string | null;
            longitude: number | null;
            name: string;
            region: string | null;
            sourceCandidateId: string;
            summary: string | null;
            /** Format: uri */
            websiteUrl: string | null;
        } | null;
        ErrorDetail: {
            code: string;
            message: string;
            meta?: {
                [key: string]: string | number | boolean | null;
            };
            path?: string;
        };
        ErrorEnvelope: {
            error: {
                code: string;
                details?: components["schemas"]["ErrorDetail"][];
                message: string;
                requestId: string;
                retryable: boolean;
            };
        };
        Event: {
            childOrderVersion: number;
            /** Format: date-time */
            createdAt: string;
            description: string | null;
            /** Format: date-time */
            endsAt: string | null;
            id: string;
            itineraryOrderVersion: number;
            /** @enum {string} */
            kind: "trip" | "day" | "golf" | "team_event" | "session" | "activity" | "other";
            parentEventId: string | null;
            rootEventId: string;
            sortKey: string;
            /** Format: date-time */
            startsAt: string | null;
            /** @enum {string} */
            status: "draft" | "published" | "cancelled" | "archived";
            timeZone: string;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        EventCapability: {
            config: {
                homePlaceId: string | null;
                travelerReferenceLabel: string | null;
            };
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "travel";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                /** @enum {string} */
                checkInPolicy: "fixed" | "flexible";
                /** @enum {string} */
                checkOutPolicy: "fixed" | "flexible";
                propertyPlaceId: string | null;
                /** @enum {string} */
                roomAssignmentMode: "organizer" | "self_service";
            };
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "lodging";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                meetingPlaceId: string | null;
                /** @enum {string} */
                participantMode: "self_arranged" | "shared" | "mixed";
            };
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "transport";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                coursePlaceId: string | null;
                /** @enum {string} */
                handicapMode: "none" | "optional" | "required";
                /** @enum {string} */
                roundState: "planned" | "open" | "closed";
                /** @enum {string} */
                scoringMode: "none" | "stroke_play" | "stableford";
                /** @enum {string} */
                teeFormat: "individual" | "pairs" | "fourball";
            };
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "golf";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                /** @enum {string} */
                assignmentMode: "organizer" | "self_select" | "random";
                capacityPerTeam: number | null;
                facilitator: string | null;
                venuePlaceId: string | null;
            };
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "team";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        EventInvitation: {
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            id: string;
            maxUses: number;
            /** Format: email */
            normalizedEmailHint: string | null;
            /** @enum {string} */
            role: "organizer" | "participant" | "viewer";
            rootEventId: string;
            /** @enum {string} */
            status: "active" | "revoked";
            /** Format: date-time */
            updatedAt: string;
            useCount: number;
            version: number;
        };
        EventInvitationAdminSummary: {
            /** Format: date-time */
            createdAt: string;
            emailBound: boolean;
            /** Format: date-time */
            expiresAt: string;
            id: string;
            maxUses: number;
            /** @enum {string} */
            role: "organizer" | "participant" | "viewer";
            rootEventId: string;
            /** @enum {string} */
            status: "active" | "revoked";
            /** Format: date-time */
            updatedAt: string;
            useCount: number;
            version: number;
        };
        EventMembership: {
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            role: "owner" | "organizer" | "participant" | "viewer";
            rootEventId: string;
            /** @enum {string} */
            status: "active" | "left" | "removed";
            /** Format: date-time */
            updatedAt: string;
            userId: string;
            version: number;
        };
        EventPlace: {
            countryCode: string;
            /** Format: date-time */
            createdAt: string;
            id: string;
            latitude: number | null;
            locality: string | null;
            longitude: number | null;
            name: string;
            rootEventId: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        EventPublishReadiness: {
            /** @description Authoritative server result; clients must not derive publish readiness locally. */
            ready: boolean;
            reasons: components["schemas"]["EventPublishReadinessReason"][];
            rootEventId: string;
            /** @description Aggregate revision covering readiness-affecting capability, place and graph changes; send it as baseRevision when publishing. */
            rootRevision: string;
            /** @description Optimistic version of the root event row; send it as baseVersion when publishing. */
            rootVersion: number;
            /** @enum {number} */
            schemaVersion: 1;
            template: {
                /** @enum {string} */
                id: "travel" | "golf-tour" | "team-event";
                /** @enum {number} */
                version: 1;
            } | null;
        };
        EventPublishReadinessReason: {
            /** @enum {string} */
            code: "EVENT_TEMPLATE_REQUIRED" | "EVENT_TITLE_REQUIRED" | "EVENT_DESCRIPTION_REQUIRED" | "EVENT_START_REQUIRED" | "EVENT_END_REQUIRED" | "EVENT_CAPABILITY_REQUIRED" | "EVENT_CAPABILITY_PLACE_REQUIRED" | "EVENT_STATUS_NOT_DRAFT";
            message: string;
            meta?: {
                /** @enum {string} */
                capabilityType?: "travel" | "lodging" | "transport" | "golf" | "team";
                eventId?: string;
            };
            path: string;
        };
        EventRecap: {
            /** Format: date-time */
            generatedAt: string;
            /** @description Only currently authorized exact source projections; revoked items are omitted as a whole. */
            items: components["schemas"]["EventRecapItem"][];
            /** @description Optimistic version for publish and remove transitions; separate from immutable content version. */
            lifecycleVersion: number;
            /** Format: date-time */
            publishedAt: string | null;
            publishedVersion: number | null;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            sourceRootRevision: string;
            /** @enum {string} */
            state: "draft" | "published";
            title: string;
            titleProvenance: {
                /** @enum {string} */
                consentBasis: "event-publication";
                sourceId: string;
                sourceRevision: string;
                /** @enum {string} */
                sourceType: "event";
                sourceVersion: number;
                /** @enum {string} */
                visibility: "members";
            };
            /** @description Immutable recap snapshot version. */
            version: number;
        };
        /** @description Current exact-body consent state, or null for a draft, old, archived, removed or source-drifted recap. */
        EventRecapExternalConsent: {
            fields: components["schemas"]["EventRecapExternalConsentField"][];
        } | null;
        EventRecapExternalConsentField: {
            /** @description Authority kinds the active caller may decide; contains no actor identity. */
            actorCanDecide: ("author" | "manager")[];
            /**
             * @description Current exact source-author decision. Event bodies report unknown because author authority is not required.
             * @enum {string}
             */
            authorDecision: "grant" | "withdraw" | "unknown";
            /** @enum {string} */
            field: "body";
            /** @enum {string} */
            managerDecision: "grant" | "withdraw" | "unknown";
            ordinal: number;
            /** @description Event bodies require only manager; feed bodies require author then manager. */
            requiredAuthorities: ("author" | "manager")[];
        };
        EventRecapExternalShare: {
            items: components["schemas"]["EventRecapExternalShareItem"][];
            title: string;
        };
        EventRecapExternalShareItem: {
            body: string | null;
            ordinal: number;
            title: string;
        } | {
            body: string;
            ordinal: number;
            title: null;
        };
        EventRecapItem: {
            ordinal: number;
            provenance: components["schemas"]["EventRecapProvenance"];
            sourceBody: string | null;
            sourceTitle: string | null;
        };
        EventRecapProvenance: {
            /** @enum {string} */
            consentBasis: "event-publication";
            sourceId: string;
            sourceRevision: string;
            /** @enum {string} */
            sourceType: "event";
            sourceVersion: number;
            /** @enum {string} */
            visibility: "members";
        } | {
            /** @enum {string} */
            consentBasis: "source-author";
            sourceId: string;
            sourceRevision: string;
            /** @enum {string} */
            sourceType: "feedEntry";
            sourceVersion: number;
            /** @enum {string} */
            visibility: "members";
        };
        EventRecapShare: {
            items: components["schemas"]["EventRecapShareItem"][];
            title: string;
        };
        EventRecapShareItem: {
            ordinal: number;
            title: string;
        };
        EventRecapShareLink: {
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            expiresAt: string;
            id: string;
            recapVersion: number;
        };
        EventRootSummary: {
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            endsAt: string | null;
            /** @enum {string} */
            kind: "trip" | "day" | "golf" | "team_event" | "session" | "activity" | "other";
            /** @enum {string} */
            membershipStatus: "active" | "left" | "removed";
            /** @enum {string} */
            role: "owner" | "organizer" | "participant" | "viewer";
            rootEventId: string;
            /** Format: date-time */
            startsAt: string | null;
            /** @enum {string} */
            status: "draft" | "published" | "cancelled" | "archived";
            timeZone: string;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        EventTemplate: {
            events: {
                capabilities: ({
                    config: {
                        homePlaceId: string | null;
                        travelerReferenceLabel: string | null;
                    };
                    /** @enum {number} */
                    schemaVersion: 1;
                    /** @enum {string} */
                    type: "travel";
                } | {
                    config: {
                        /** @enum {string} */
                        checkInPolicy: "fixed" | "flexible";
                        /** @enum {string} */
                        checkOutPolicy: "fixed" | "flexible";
                        propertyPlaceId: string | null;
                        /** @enum {string} */
                        roomAssignmentMode: "organizer" | "self_service";
                    };
                    /** @enum {number} */
                    schemaVersion: 1;
                    /** @enum {string} */
                    type: "lodging";
                } | {
                    config: {
                        meetingPlaceId: string | null;
                        /** @enum {string} */
                        participantMode: "self_arranged" | "shared" | "mixed";
                    };
                    /** @enum {number} */
                    schemaVersion: 1;
                    /** @enum {string} */
                    type: "transport";
                } | {
                    config: {
                        coursePlaceId: string | null;
                        /** @enum {string} */
                        handicapMode: "none" | "optional" | "required";
                        /** @enum {string} */
                        roundState: "planned" | "open" | "closed";
                        /** @enum {string} */
                        scoringMode: "none" | "stroke_play" | "stableford";
                        /** @enum {string} */
                        teeFormat: "individual" | "pairs" | "fourball";
                    };
                    /** @enum {number} */
                    schemaVersion: 1;
                    /** @enum {string} */
                    type: "golf";
                } | {
                    config: {
                        /** @enum {string} */
                        assignmentMode: "organizer" | "self_select" | "random";
                        capacityPerTeam: number | null;
                        facilitator: string | null;
                        venuePlaceId: string | null;
                    };
                    /** @enum {number} */
                    schemaVersion: 1;
                    /** @enum {string} */
                    type: "team";
                })[];
                /** @enum {string} */
                kind: "trip" | "day" | "golf" | "team_event" | "session" | "activity" | "other";
                logicalKey: string;
                parentLogicalKey: string | null;
                title: string;
            }[];
            /** @enum {string} */
            id: "travel" | "golf-tour" | "team-event";
            summary: string;
            title: string;
            /** @enum {number} */
            version: 1;
        };
        EventTemplateAdoptionResponse: {
            event: components["schemas"]["Event"];
            rootRevision: string;
            template: {
                /** @enum {string} */
                id: "travel" | "golf-tour" | "team-event";
                /** @enum {number} */
                version: 1;
            };
        };
        Feedback: {
            /** @description Committed same-root assets. Empty when the reader no longer has current event access. */
            attachments: components["schemas"]["FeedbackAttachment"][];
            /** @description Null for every public reader other than the feedback author or a current root owner/organizer. */
            authorUserId: string | null;
            body: string;
            commentCount: number;
            comments: components["schemas"]["FeedbackComment"][];
            commentsHasMore: boolean;
            context: components["schemas"]["FeedbackContext"];
            /** Format: date-time */
            createdAt: string;
            diagnostics: components["schemas"]["FeedbackDiagnostics"];
            duplicateOfFeedbackId: string | null;
            id: string;
            /** @enum {string} */
            status: "open" | "planned" | "in_progress" | "completed" | "declined" | "duplicate";
            statusHistory: components["schemas"]["FeedbackStatusChange"][];
            statusHistoryCount: number;
            statusHistoryHasMore: boolean;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
            viewerHasVoted: boolean;
            /** @enum {string} */
            visibility: "public" | "private";
            voteCount: number;
        };
        FeedbackAttachment: {
            byteCount: number;
            caption: string | null;
            /** @enum {string} */
            contentType: "image/jpeg" | "image/png" | "image/webp";
            /** Format: date-time */
            createdAt: string;
            id: string;
            sha256: string;
        };
        FeedbackComment: {
            /** @description Null for every public reader other than the feedback author or a current root owner/organizer. */
            authorUserId: string | null;
            body: string;
            /** Format: date-time */
            createdAt: string;
            id: string;
        };
        FeedbackContext: {
            eventId: string | null;
            rootEventId: string | null;
            screenKey: string | null;
        } | null;
        /** @description Returned only to the author or a current event owner/organizer; null for every other reader. */
        FeedbackDiagnostics: {
            appVersion?: string;
            buildNumber?: string;
            deviceModel?: string;
            locale?: string;
            osVersion?: string;
            /** @enum {string} */
            platform?: "ios" | "android";
        } | null;
        FeedbackStatusChange: {
            /** Format: date-time */
            changedAt: string;
            /** @description Null for every public reader other than the feedback author or a current root owner/organizer. */
            changedBy: string | null;
            fromStatus: ("open" | "planned" | "in_progress" | "completed" | "declined" | "duplicate") | null;
            note: string | null;
            /** @enum {string} */
            toStatus: "open" | "planned" | "in_progress" | "completed" | "declined" | "duplicate";
            version: number;
        };
        ItineraryItem: {
            allDay: boolean;
            /** Format: date-time */
            createdAt: string;
            details: {
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "note";
            } | {
                bookingReference?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "activity";
            } | {
                destinationPlaceId: string;
                destinationPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                flightDesignator?: string;
                originPlaceId: string;
                originPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "flight";
            } | {
                destinationPlaceId: string;
                destinationPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                originPlaceId: string;
                originPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                /** @enum {number} */
                schemaVersion: 1;
                serviceDesignator?: string;
                /** @enum {string} */
                type: "rail";
            } | {
                destinationPlaceId: string;
                destinationPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                originPlaceId: string;
                originPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                pickupInstructions?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "road_transfer";
            } | {
                /** Format: date-time */
                checkInAt: string;
                /** Format: date-time */
                checkOutAt: string;
                propertyName: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "lodging";
            } | {
                reservationNote?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "meal";
            } | {
                roundReference: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** Format: date-time */
                teeTime: string;
                /** @enum {string} */
                type: "golf_round";
            } | {
                descendantEventId?: string;
                room?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "session";
            };
            /** Format: date-time */
            endsAt: string | null;
            eventId: string;
            id: string;
            notes: string | null;
            placeId: string | null;
            placeSnapshot: {
                countryCode: string;
                id: string;
                latitude: number | null;
                locality: string | null;
                longitude: number | null;
                name: string;
            } | null;
            rootEventId: string;
            sortKey: string;
            /** Format: date-time */
            startsAt: string | null;
            /** @enum {string} */
            status: "active" | "cancelled" | "archived";
            timeZone: string;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        PlaceEnrichment: {
            /** Format: date-time */
            completedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            id: string;
            pollAfterSeconds: number | null;
            retryAllowed: boolean;
            /** @enum {string} */
            status: "pending" | "processing" | "retry" | "succeeded" | "failed" | "dead";
            /** Format: date-time */
            updatedAt: string;
        };
        PlaceSearchResult: {
            attribution: string;
            confidence: number;
            countryCode: string;
            id: string;
            /** @enum {string} */
            kind: "golf_course" | "venue";
            latitude: number | null;
            licenseCode: string;
            /** Format: uri */
            licenseUrl: string | null;
            locality: string | null;
            longitude: number | null;
            name: string;
            region: string | null;
            /** Format: date-time */
            retrievedAt: string;
            source: string;
            /** Format: uri */
            sourceRecordUrl: string | null;
            /** @enum {string} */
            status: "pending" | "enriched";
            version: number;
        };
        RecapExternalField: {
            /** @enum {string} */
            field: "body";
            sourceId: string;
            /** @enum {string} */
            sourceType: "event";
            sourceVersion: number;
        } | {
            /** @enum {string} */
            field: "body";
            sourceId: string;
            /** @enum {string} */
            sourceType: "feedEntry";
            sourceVersion: number;
        };
        RecapExternalGrantDecision: {
            /** @enum {string} */
            authority: "manager";
            /** @enum {string} */
            decision: "grant" | "withdraw";
            /** @enum {string} */
            field: "body";
            recapVersion: number;
            sourceId: string;
            /** @enum {string} */
            sourceType: "event";
            sourceVersion: number;
        } | {
            /** @enum {string} */
            authority: "author" | "manager";
            /** @enum {string} */
            decision: "grant" | "withdraw";
            /** @enum {string} */
            field: "body";
            recapVersion: number;
            sourceId: string;
            /** @enum {string} */
            sourceType: "feedEntry";
            sourceVersion: number;
        };
        RecapExternalShareCreate: {
            fields: components["schemas"]["RecapExternalField"][];
            /** @enum {string} */
            projectionConsent: "exact-fields-reviewed-v1";
            recapVersion: number;
        };
        RecapShareCreate: {
            /** @enum {string} */
            projectionConsent: "title-only-reviewed";
            recapVersion: number;
        };
        SyncAttachmentData: {
            byteCount: number;
            caption: string | null;
            /** @enum {string} */
            contentType: "image/jpeg" | "image/png" | "image/webp";
            /** Format: date-time */
            createdAt: string;
            id: string;
            rootEventId: string;
            sha256: string;
            target: {
                entityId: string;
                /** @enum {string} */
                entityType: "feedEntry";
            };
            version: number;
        };
        SyncBootstrapResponse: {
            authorizationScopeVersion: string;
            pageInfo: {
                hasMore: boolean;
                nextCursor: string | null;
            };
            /** @enum {number} */
            protocolVersion: 1;
            records: ({
                data: components["schemas"]["SyncEventData"];
                entityId: string;
                /** @enum {string} */
                entityType: "event";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncMembershipData"];
                entityId: string;
                /** @enum {string} */
                entityType: "membership";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncInvitationData"];
                entityId: string;
                /** @enum {string} */
                entityType: "invitation";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncPlaceData"];
                entityId: string;
                /** @enum {string} */
                entityType: "place";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncCapabilityData"];
                entityId: string;
                /** @enum {string} */
                entityType: "capability";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncItineraryData"];
                entityId: string;
                /** @enum {string} */
                entityType: "itineraryItem";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncFeedEntryData"];
                entityId: string;
                /** @enum {string} */
                entityType: "feedEntry";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncFeedReactionData"];
                entityId: string;
                /** @enum {string} */
                entityType: "feedReaction";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncAttachmentData"];
                entityId: string;
                /** @enum {string} */
                entityType: "attachment";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncGolfRoundData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfRound";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncGolfRosterData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfRoster";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncGolfPlayerData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfPlayer";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncGolfScoreData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfScore";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncGolfLeaderboardData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfLeaderboard";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncTeamAssignmentSetData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamAssignmentSet";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncTeamAssignmentRosterData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamAssignmentRoster";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncTeamAssignmentData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamAssignment";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncTeamDecisionData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamDecision";
                entityVersion: number;
            } | {
                data: components["schemas"]["SyncTeamResponseData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamResponse";
                entityVersion: number;
            })[];
            rootEventId: string;
            snapshotId: string;
            snapshotRevision: string;
            syncCursor: string;
        };
        SyncCapabilityData: {
            config: {
                homePlaceId: string | null;
                travelerReferenceLabel: string | null;
            };
            /** Format: date-time */
            createdAt: string;
            deletedAt: null;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "travel";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                /** @enum {string} */
                checkInPolicy: "fixed" | "flexible";
                /** @enum {string} */
                checkOutPolicy: "fixed" | "flexible";
                propertyPlaceId: string | null;
                /** @enum {string} */
                roomAssignmentMode: "organizer" | "self_service";
            };
            /** Format: date-time */
            createdAt: string;
            deletedAt: null;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "lodging";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                meetingPlaceId: string | null;
                /** @enum {string} */
                participantMode: "self_arranged" | "shared" | "mixed";
            };
            /** Format: date-time */
            createdAt: string;
            deletedAt: null;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "transport";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                coursePlaceId: string | null;
                /** @enum {string} */
                handicapMode: "none" | "optional" | "required";
                /** @enum {string} */
                roundState: "planned" | "open" | "closed";
                /** @enum {string} */
                scoringMode: "none" | "stroke_play" | "stableford";
                /** @enum {string} */
                teeFormat: "individual" | "pairs" | "fourball";
            };
            /** Format: date-time */
            createdAt: string;
            deletedAt: null;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "golf";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        } | {
            config: {
                /** @enum {string} */
                assignmentMode: "organizer" | "self_select" | "random";
                capacityPerTeam: number | null;
                facilitator: string | null;
                venuePlaceId: string | null;
            };
            /** Format: date-time */
            createdAt: string;
            deletedAt: null;
            eventId: string;
            rootEventId: string;
            /** @enum {number} */
            schemaVersion: 1;
            /** @enum {string} */
            type: "team";
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncEventData: {
            childOrderVersion: number;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            deletedAt: string | null;
            description: string | null;
            /** Format: date-time */
            endsAt: string | null;
            id: string;
            itineraryOrderVersion: number;
            /** @enum {string} */
            kind: "trip" | "day" | "golf" | "team_event" | "session" | "activity" | "other";
            parentEventId: string | null;
            rootEventId: string;
            sortKey: string;
            /** Format: date-time */
            startsAt: string | null;
            /** @enum {string} */
            status: "draft" | "published" | "cancelled" | "archived";
            timeZone: string;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncFeedEntryData: {
            actorUserId: string | null;
            /** Format: date-time */
            createdAt: string;
            createdRootRevision: string;
            deletedAt: null;
            eventId: string | null;
            id: string;
            /** @enum {string} */
            kind: "message" | "comment" | "system";
            parentEntryId: string | null;
            payload: {
                text: string | null;
            };
            /** @enum {number} */
            payloadSchemaVersion: 1;
            rootEventId: string;
            rootRevision: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncFeedReactionData: {
            entryId: string;
            /** @enum {boolean} */
            present: true;
            /** @enum {string} */
            reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
            rootEventId: string;
            /** Format: date-time */
            updatedAt: string;
            userId: string;
            version: number;
        };
        SyncGolfHoleData: {
            hole: number;
            par: number;
            strokeIndex: number;
        };
        SyncGolfLeaderboardData: {
            entries: components["schemas"]["SyncGolfLeaderboardEntryData"][];
            eventId: string;
            rootEventId: string;
            version: number;
        };
        SyncGolfLeaderboardEntryData: {
            holesCompleted: number;
            rank: number;
            stablefordPoints: number;
            teamId: string | null;
            userId: string;
        };
        SyncGolfPlayerData: {
            eventId: string;
            playingHandicap: number;
            rootEventId: string;
            userId: string;
            version: number;
        };
        SyncGolfRosterData: {
            eventId: string;
            players: {
                playingHandicap: number;
                userId: string;
            }[];
            rootEventId: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncGolfRoundData: {
            eventId: string;
            holes: components["schemas"]["SyncGolfHoleData"][];
            rootEventId: string;
            teams: components["schemas"]["SyncGolfTeamData"][];
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncGolfScoreData: {
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            handicapStrokes: number;
            hole: number;
            id: string;
            netStrokes: number | null;
            playingHandicap: number;
            putts: number | null;
            rootEventId: string;
            rootRevision: string;
            stablefordPoints: number;
            strokes: number | null;
            /** Format: date-time */
            updatedAt: string;
            userId: string;
            version: number;
        };
        SyncGolfTeamData: {
            color: string | null;
            id: string;
            memberUserIds: string[];
            name: string;
        };
        SyncInvitationData: {
            /** Format: date-time */
            createdAt: string;
            emailBound: boolean;
            /** Format: date-time */
            expiresAt: string;
            id: string;
            maxUses: number;
            /** @enum {string} */
            role: "organizer" | "participant" | "viewer";
            rootEventId: string;
            /** @enum {string} */
            status: "active" | "revoked";
            /** Format: date-time */
            updatedAt: string;
            useCount: number;
            version: number;
        };
        SyncItineraryData: {
            allDay: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            deletedAt: string | null;
            details: {
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "note";
            } | {
                bookingReference?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "activity";
            } | {
                destinationPlaceId: string;
                destinationPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                flightDesignator?: string;
                originPlaceId: string;
                originPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "flight";
            } | {
                destinationPlaceId: string;
                destinationPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                originPlaceId: string;
                originPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                /** @enum {number} */
                schemaVersion: 1;
                serviceDesignator?: string;
                /** @enum {string} */
                type: "rail";
            } | {
                destinationPlaceId: string;
                destinationPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                originPlaceId: string;
                originPlaceSnapshot: {
                    countryCode: string;
                    id: string;
                    latitude: number | null;
                    locality: string | null;
                    longitude: number | null;
                    name: string;
                };
                pickupInstructions?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "road_transfer";
            } | {
                /** Format: date-time */
                checkInAt: string;
                /** Format: date-time */
                checkOutAt: string;
                propertyName: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "lodging";
            } | {
                reservationNote?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "meal";
            } | {
                roundReference: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** Format: date-time */
                teeTime: string;
                /** @enum {string} */
                type: "golf_round";
            } | {
                descendantEventId?: string;
                room?: string;
                /** @enum {number} */
                schemaVersion: 1;
                /** @enum {string} */
                type: "session";
            };
            /** Format: date-time */
            endsAt: string | null;
            eventId: string;
            id: string;
            notes: string | null;
            placeId: string | null;
            placeSnapshot: {
                countryCode: string;
                id: string;
                latitude: number | null;
                locality: string | null;
                longitude: number | null;
                name: string;
            } | null;
            rootEventId: string;
            sortKey: string;
            /** Format: date-time */
            startsAt: string | null;
            /** @enum {string} */
            status: "active" | "cancelled" | "archived";
            timeZone: string;
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncMembershipData: {
            /** Format: date-time */
            createdAt: string;
            /** @enum {string} */
            role: "owner" | "organizer" | "participant" | "viewer";
            rootEventId: string;
            /** @enum {string} */
            status: "active" | "left" | "removed";
            /** Format: date-time */
            updatedAt: string;
            userId: string;
            version: number;
        };
        SyncPlaceData: {
            countryCode: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            deletedAt: string | null;
            id: string;
            latitude: number | null;
            locality: string | null;
            longitude: number | null;
            name: string;
            rootEventId: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncPullResponse: {
            authorizationScopeVersion: string;
            changes: (({
                data: components["schemas"]["SyncEventData"];
                entityId: string;
                /** @enum {string} */
                entityType: "event";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncMembershipData"];
                entityId: string;
                /** @enum {string} */
                entityType: "membership";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncInvitationData"];
                entityId: string;
                /** @enum {string} */
                entityType: "invitation";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncPlaceData"];
                entityId: string;
                /** @enum {string} */
                entityType: "place";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncCapabilityData"];
                entityId: string;
                /** @enum {string} */
                entityType: "capability";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncItineraryData"];
                entityId: string;
                /** @enum {string} */
                entityType: "itineraryItem";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncFeedEntryData"];
                entityId: string;
                /** @enum {string} */
                entityType: "feedEntry";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncFeedReactionData"];
                entityId: string;
                /** @enum {string} */
                entityType: "feedReaction";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncAttachmentData"];
                entityId: string;
                /** @enum {string} */
                entityType: "attachment";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncGolfRoundData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfRound";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncGolfRosterData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfRoster";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncGolfPlayerData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfPlayer";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncGolfScoreData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfScore";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncGolfLeaderboardData"];
                entityId: string;
                /** @enum {string} */
                entityType: "golfLeaderboard";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncTeamAssignmentSetData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamAssignmentSet";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncTeamAssignmentRosterData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamAssignmentRoster";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncTeamAssignmentData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamAssignment";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncTeamDecisionData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamDecision";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            } | {
                data: components["schemas"]["SyncTeamResponseData"];
                entityId: string;
                /** @enum {string} */
                entityType: "teamResponse";
                entityVersion: number;
                /** @enum {string} */
                operation: "upsert";
                ordinal: number;
                rootRevision: string;
            }) | ({
                entityId: string;
                /** @enum {string} */
                entityType: "event";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    /** @enum {string} */
                    entityType: "event";
                    eventId: string;
                    id: string;
                    rootEventId: string;
                    version: number;
                };
            } | {
                entityId: string;
                /** @enum {string} */
                entityType: "teamAssignment";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    /** @enum {string} */
                    entityType: "teamAssignment";
                    eventId: string;
                    id: string;
                    rootEventId: string;
                    version: number;
                };
            } | {
                entityId: string;
                /** @enum {string} */
                entityType: "invitation";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    /** @enum {string} */
                    entityType: "invitation";
                    eventId: string;
                    id: string;
                    rootEventId: string;
                    version: number;
                };
            } | {
                entityId: string;
                /** @enum {string} */
                entityType: "itineraryItem";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    /** @enum {string} */
                    entityType: "itineraryItem";
                    eventId: string;
                    id: string;
                    rootEventId: string;
                    version: number;
                };
            } | {
                entityId: string;
                /** @enum {string} */
                entityType: "golfPlayer";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    /** @enum {string} */
                    entityType: "golfPlayer";
                    eventId: string;
                    id: string;
                    rootEventId: string;
                    version: number;
                };
            } | {
                entityId: string;
                /** @enum {string} */
                entityType: "capability";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    /** @enum {string} */
                    entityType: "capability";
                    eventId: string;
                    id: string;
                    rootEventId: string;
                    /** @enum {string} */
                    type: "travel" | "lodging" | "transport" | "golf" | "team";
                    version: number;
                };
            } | {
                entityId: string;
                /** @enum {string} */
                entityType: "feedEntry";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    eventId: string | null;
                    id: string;
                    rootEventId: string;
                    version: number;
                };
            } | {
                entityId: string;
                /** @enum {string} */
                entityType: "feedReaction";
                entityVersion: number;
                /** @enum {string} */
                operation: "tombstone";
                ordinal: number;
                rootRevision: string;
                tombstone: {
                    /** Format: date-time */
                    deletedAt: string;
                    entryId: string;
                    /** @enum {string} */
                    reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                    rootEventId: string;
                    userId: string;
                    version: number;
                };
            }))[];
            checkpointCursor: string;
            pageInfo: {
                hasMore: boolean;
                nextCursor: string | null;
            };
            /** @enum {number} */
            protocolVersion: 1;
            rootEventId: string;
        };
        SyncPushResponse: {
            deviceId: string;
            nextExpectedClientSequence: number;
            /** @enum {number} */
            protocolVersion: 1;
            results: ({
                /** Format: uuid */
                clientMutationId: string;
                clientSequence: number;
                entity?: {
                    entityId: string;
                    /** @enum {string} */
                    entityType: "event" | "membership" | "invitation" | "place" | "capability" | "itineraryItem" | "feedEntry" | "feedReaction" | "attachment" | "golfRound" | "golfRoster" | "golfPlayer" | "golfScore" | "golfLeaderboard" | "teamAssignmentSet" | "teamAssignmentRoster" | "teamAssignment" | "teamDecision" | "teamResponse";
                    version: number;
                };
                /** @enum {string} */
                outcome: "applied";
                replayed: boolean;
                rootRevision: string;
            } | {
                /** Format: uuid */
                clientMutationId: string;
                clientSequence: number;
                error: {
                    authoritativeOrder?: string[];
                    code: string;
                    currentVersion?: number;
                    message: string;
                    /** @enum {boolean} */
                    retryable: false;
                };
                /** @enum {string} */
                outcome: "rejected";
                replayed: boolean;
            } | {
                /** Format: uuid */
                clientMutationId: string;
                clientSequence: number;
                error: {
                    authoritativeOrder?: string[];
                    code: string;
                    currentVersion?: number;
                    message: string;
                    /** @enum {boolean} */
                    retryable: true;
                };
                /** @enum {string} */
                outcome: "retry";
                /** @enum {boolean} */
                replayed: false;
                retryAfterSeconds: number;
            } | {
                /** Format: uuid */
                clientMutationId: string;
                clientSequence: number;
                error: {
                    authoritativeOrder?: string[];
                    code: string;
                    currentVersion?: number;
                    message: string;
                    /** @enum {boolean} */
                    retryable: false;
                };
                /** @enum {string} */
                outcome: "blocked";
                /** @enum {boolean} */
                replayed: false;
            })[];
            rootEventId: string;
        };
        SyncTeamAssignmentData: {
            eventId: string;
            rootEventId: string;
            team: components["schemas"]["SyncTeamPublicTeamData"];
            /** Format: date-time */
            updatedAt: string;
            userId: string;
            version: number;
        };
        SyncTeamAssignmentRosterData: {
            eventId: string;
            rootEventId: string;
            teams: {
                color: string | null;
                id: string;
                memberUserIds: string[];
                name: string;
            }[];
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncTeamAssignmentSetData: {
            eventId: string;
            rootEventId: string;
            teams: components["schemas"]["SyncTeamPublicTeamData"][];
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncTeamDecisionData: {
            aggregateVersion: number;
            /** Format: date-time */
            createdAt: string;
            eventId: string;
            id: string;
            options: components["schemas"]["SyncTeamDecisionOptionData"][];
            responseCount: number;
            rootEventId: string;
            /** @enum {string} */
            state: "draft" | "open" | "closed";
            title: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        SyncTeamDecisionOptionData: {
            id: string;
            label: string;
            responseCount: number;
        };
        SyncTeamPublicTeamData: {
            color: string | null;
            id: string;
            name: string;
        };
        SyncTeamResponseData: {
            /** Format: date-time */
            createdAt: string;
            decisionId: string;
            eventId: string;
            id: string;
            optionId: string;
            rootEventId: string;
            rootRevision: string;
            /** Format: date-time */
            updatedAt: string;
            userId: string;
            version: number;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
    eventRootsList: {
        parameters: {
            query?: {
                cursor?: string;
                includeArchived?: "true" | "false";
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Visible root events */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["EventRootSummary"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default null */
                    description?: string | null;
                    /**
                     * Format: date-time
                     * @default null
                     */
                    endsAt?: string | null;
                    id: string;
                    /** @enum {string} */
                    kind: "trip" | "day" | "golf" | "team_event" | "session" | "activity" | "other";
                    /**
                     * Format: date-time
                     * @default null
                     */
                    startsAt?: string | null;
                    /**
                     * @default draft
                     * @enum {string}
                     */
                    status?: "draft";
                    template?: {
                        eventIds: {
                            [key: string]: string;
                        };
                        id: string;
                        version: number;
                    };
                    timeZone: string;
                    title: string;
                };
            };
        };
        responses: {
            /** @description Root event created */
            201: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsTreeGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Visible event graph */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        capabilities: components["schemas"]["EventCapability"][];
                        events: components["schemas"]["Event"][];
                        rootEventId: string;
                        rootRevision: string;
                    };
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventAttachmentsDownload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                attachmentId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Short authorized private download */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        attachment: {
                            byteCount: number;
                            caption: string | null;
                            /** @enum {string} */
                            contentType: "image/jpeg" | "image/png" | "image/webp";
                            /** Format: date-time */
                            createdAt: string;
                            id: string;
                            /** @enum {string} */
                            integrityStatus: "integrity_verified";
                            rootEventId: string;
                            rootRevision: string;
                            sha256: string;
                            target: components["schemas"]["AttachmentTarget"];
                            /** @description Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations. */
                            targetEntryId: string | null;
                            version: number;
                        };
                        download: {
                            /** Format: date-time */
                            expiresAt: string;
                            headers: {
                                [key: string]: string;
                            };
                            /** @enum {string} */
                            method: "GET";
                            /** Format: uri */
                            url: string;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventAttachmentUploadsPrepare: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttachmentUploadPrepare"];
            };
        };
        responses: {
            /** @description Private upload lease prepared */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        grant: {
                            /** Format: date-time */
                            expiresAt: string;
                            fields: {
                                [key: string]: string;
                            };
                            /** @enum {string} */
                            method: "POST";
                            /** Format: uri */
                            url: string;
                        };
                        upload: {
                            attachmentId: string;
                            byteCount: number;
                            /** @enum {string} */
                            contentType: "image/jpeg" | "image/png" | "image/webp";
                            /** Format: date-time */
                            createdAt: string;
                            /** Format: date-time */
                            expiresAt: string;
                            id: string;
                            rootEventId: string;
                            sha256: string;
                            /** @enum {string} */
                            state: "prepared" | "committed" | "expired";
                            target: components["schemas"]["AttachmentTarget"];
                            /** @description Legacy feed-entry projection. Null for feedback-bound uploads; use target for new integrations. */
                            targetEntryId: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventAttachmentUploadsFinalize: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
                uploadId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    caption: string | null;
                };
            };
        };
        responses: {
            /** @description Integrity-verified attachment committed */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        attachment: {
                            byteCount: number;
                            caption: string | null;
                            /** @enum {string} */
                            contentType: "image/jpeg" | "image/png" | "image/webp";
                            /** Format: date-time */
                            createdAt: string;
                            id: string;
                            /** @enum {string} */
                            integrityStatus: "integrity_verified";
                            rootEventId: string;
                            rootRevision: string;
                            sha256: string;
                            target: components["schemas"]["AttachmentTarget"];
                            /** @description Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations. */
                            targetEntryId: string | null;
                            version: number;
                        };
                    };
                };
            };
            /** @description Attachment verification is durably queued or in progress */
            202: {
                headers: {
                    /** @description Pending verification is never a stored terminal replay */
                    "Idempotency-Replayed"?: "false";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        uploadId: string;
                        verification: {
                            /** @enum {boolean} */
                            retryable: true;
                            /** @enum {string} */
                            state: "pending" | "processing" | "retry";
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventChildrenCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default null */
                    description?: string | null;
                    /**
                     * Format: date-time
                     * @default null
                     */
                    endsAt?: string | null;
                    id: string;
                    /** @enum {string} */
                    kind: "trip" | "day" | "golf" | "team_event" | "session" | "activity" | "other";
                    parentEventId: string;
                    /**
                     * Format: date-time
                     * @default null
                     */
                    startsAt?: string | null;
                    /**
                     * @default draft
                     * @enum {string}
                     */
                    status?: "draft" | "published" | "cancelled" | "archived";
                    timeZone: string;
                    title: string;
                };
            };
        };
        responses: {
            /** @description Event created */
            201: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Event */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsDelete: {
        parameters: {
            query: {
                baseVersion: number;
                subtree?: "true" | "false";
            };
            header: {
                "idempotency-key": string;
            };
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Event tombstoned */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        deleted: true;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsUpdate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                    changes: {
                        description?: string | null;
                        /** Format: date-time */
                        endsAt?: string | null;
                        /** Format: date-time */
                        startsAt?: string | null;
                        /** @enum {string} */
                        status?: "draft" | "published" | "cancelled" | "archived";
                        timeZone?: string;
                        title?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Event updated */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsArchive: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                };
            };
        };
        responses: {
            /** @description Event archived */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventCapabilitiesReplace: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                capabilityType: "travel" | "lodging" | "transport" | "golf" | "team";
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                    capability: {
                        config: {
                            homePlaceId: string | null;
                            travelerReferenceLabel: string | null;
                        };
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "travel";
                    } | {
                        config: {
                            /** @enum {string} */
                            checkInPolicy: "fixed" | "flexible";
                            /** @enum {string} */
                            checkOutPolicy: "fixed" | "flexible";
                            propertyPlaceId: string | null;
                            /** @enum {string} */
                            roomAssignmentMode: "organizer" | "self_service";
                        };
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "lodging";
                    } | {
                        config: {
                            meetingPlaceId: string | null;
                            /** @enum {string} */
                            participantMode: "self_arranged" | "shared" | "mixed";
                        };
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "transport";
                    } | {
                        config: {
                            coursePlaceId: string | null;
                            /** @enum {string} */
                            handicapMode: "none" | "optional" | "required";
                            /** @enum {string} */
                            roundState: "planned" | "open" | "closed";
                            /** @enum {string} */
                            scoringMode: "none" | "stroke_play" | "stableford";
                            /** @enum {string} */
                            teeFormat: "individual" | "pairs" | "fourball";
                        };
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "golf";
                    } | {
                        config: {
                            /** @enum {string} */
                            assignmentMode: "organizer" | "self_select" | "random";
                            capacityPerTeam: number | null;
                            facilitator: string | null;
                            venuePlaceId: string | null;
                        };
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "team";
                    };
                };
            };
        };
        responses: {
            /** @description Capability replaced */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        capability: components["schemas"]["EventCapability"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventCapabilitiesRemove: {
        parameters: {
            query: {
                baseVersion: number;
            };
            header: {
                "idempotency-key": string;
            };
            path: {
                capabilityType: "travel" | "lodging" | "transport" | "golf" | "team";
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Capability tombstoned */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        deleted: true;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventChildrenReorder: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseOrderVersion: number;
                    orderedIds: string[];
                };
            };
        };
        responses: {
            /** @description Children reordered */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        events: components["schemas"]["Event"][];
                        parent: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventItineraryItemsList: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Itinerary items */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["ItineraryItem"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventItineraryItemsReorder: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseOrderVersion: number;
                    orderedIds: string[];
                };
            };
        };
        responses: {
            /** @description Itinerary reordered */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                        items: components["schemas"]["ItineraryItem"][];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsReparent: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                eventId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                    parentEventId: string;
                };
            };
        };
        responses: {
            /** @description Event moved */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedEntriesList: {
        parameters: {
            query?: {
                cursor?: string;
                eventId?: string;
                kind?: "message" | "comment" | "system";
                limit?: number;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Feed page */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            attachments: {
                                byteCount: number;
                                caption: string | null;
                                /** @enum {string} */
                                contentType: "image/jpeg" | "image/png" | "image/webp";
                                /** Format: date-time */
                                createdAt: string;
                                id: string;
                                /** @enum {string} */
                                integrityStatus: "integrity_verified";
                                rootEventId: string;
                                rootRevision: string;
                                sha256: string;
                                target: components["schemas"]["AttachmentTarget"];
                                /** @description Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations. */
                                targetEntryId: string | null;
                                version: number;
                            }[];
                            authorUserId: string | null;
                            body: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            createdRootRevision: string;
                            /** Format: date-time */
                            deletedAt: string | null;
                            eventId: string | null;
                            id: string;
                            /** @enum {string} */
                            kind: "message" | "comment" | "system";
                            parentEntryId: string | null;
                            /** @enum {number} */
                            payloadSchemaVersion: 1;
                            reactions: {
                                count: number;
                                /** @enum {string} */
                                reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                                viewerPresent: boolean;
                            }[];
                            rootEventId: string;
                            rootRevision: string;
                            tombstoneReason: ("author" | "moderation") | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                        }[];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedEntriesCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    body: string;
                    eventId: string | null;
                    id: string;
                    /** @enum {string} */
                    kind: "message" | "comment";
                    parentEntryId: string | null;
                };
            };
        };
        responses: {
            /** @description Feed entry created */
            201: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        entry: {
                            attachments: {
                                byteCount: number;
                                caption: string | null;
                                /** @enum {string} */
                                contentType: "image/jpeg" | "image/png" | "image/webp";
                                /** Format: date-time */
                                createdAt: string;
                                id: string;
                                /** @enum {string} */
                                integrityStatus: "integrity_verified";
                                rootEventId: string;
                                rootRevision: string;
                                sha256: string;
                                target: components["schemas"]["AttachmentTarget"];
                                /** @description Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations. */
                                targetEntryId: string | null;
                                version: number;
                            }[];
                            authorUserId: string | null;
                            body: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            createdRootRevision: string;
                            /** Format: date-time */
                            deletedAt: string | null;
                            eventId: string | null;
                            id: string;
                            /** @enum {string} */
                            kind: "message" | "comment" | "system";
                            parentEntryId: string | null;
                            /** @enum {number} */
                            payloadSchemaVersion: 1;
                            reactions: {
                                count: number;
                                /** @enum {string} */
                                reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                                viewerPresent: boolean;
                            }[];
                            rootEventId: string;
                            rootRevision: string;
                            tombstoneReason: ("author" | "moderation") | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedEntriesGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                entryId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Feed entry */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        entry: {
                            attachments: {
                                byteCount: number;
                                caption: string | null;
                                /** @enum {string} */
                                contentType: "image/jpeg" | "image/png" | "image/webp";
                                /** Format: date-time */
                                createdAt: string;
                                id: string;
                                /** @enum {string} */
                                integrityStatus: "integrity_verified";
                                rootEventId: string;
                                rootRevision: string;
                                sha256: string;
                                target: components["schemas"]["AttachmentTarget"];
                                /** @description Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations. */
                                targetEntryId: string | null;
                                version: number;
                            }[];
                            authorUserId: string | null;
                            body: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            createdRootRevision: string;
                            /** Format: date-time */
                            deletedAt: string | null;
                            eventId: string | null;
                            id: string;
                            /** @enum {string} */
                            kind: "message" | "comment" | "system";
                            parentEntryId: string | null;
                            /** @enum {number} */
                            payloadSchemaVersion: 1;
                            reactions: {
                                count: number;
                                /** @enum {string} */
                                reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                                viewerPresent: boolean;
                            }[];
                            rootEventId: string;
                            rootRevision: string;
                            tombstoneReason: ("author" | "moderation") | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedEntriesRemove: {
        parameters: {
            query: {
                baseVersion: number;
            };
            header: {
                "idempotency-key": string;
            };
            path: {
                entryId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Feed entry tombstoned */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        entry: {
                            attachments: {
                                byteCount: number;
                                caption: string | null;
                                /** @enum {string} */
                                contentType: "image/jpeg" | "image/png" | "image/webp";
                                /** Format: date-time */
                                createdAt: string;
                                id: string;
                                /** @enum {string} */
                                integrityStatus: "integrity_verified";
                                rootEventId: string;
                                rootRevision: string;
                                sha256: string;
                                target: components["schemas"]["AttachmentTarget"];
                                /** @description Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations. */
                                targetEntryId: string | null;
                                version: number;
                            }[];
                            authorUserId: string | null;
                            body: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            createdRootRevision: string;
                            /** Format: date-time */
                            deletedAt: string | null;
                            eventId: string | null;
                            id: string;
                            /** @enum {string} */
                            kind: "message" | "comment" | "system";
                            parentEntryId: string | null;
                            /** @enum {number} */
                            payloadSchemaVersion: 1;
                            reactions: {
                                count: number;
                                /** @enum {string} */
                                reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                                viewerPresent: boolean;
                            }[];
                            rootEventId: string;
                            rootRevision: string;
                            tombstoneReason: ("author" | "moderation") | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedEntriesRevise: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                entryId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                    body: string;
                };
            };
        };
        responses: {
            /** @description Feed entry revised */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        entry: {
                            attachments: {
                                byteCount: number;
                                caption: string | null;
                                /** @enum {string} */
                                contentType: "image/jpeg" | "image/png" | "image/webp";
                                /** Format: date-time */
                                createdAt: string;
                                id: string;
                                /** @enum {string} */
                                integrityStatus: "integrity_verified";
                                rootEventId: string;
                                rootRevision: string;
                                sha256: string;
                                target: components["schemas"]["AttachmentTarget"];
                                /** @description Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations. */
                                targetEntryId: string | null;
                                version: number;
                            }[];
                            authorUserId: string | null;
                            body: string | null;
                            /** Format: date-time */
                            createdAt: string;
                            createdRootRevision: string;
                            /** Format: date-time */
                            deletedAt: string | null;
                            eventId: string | null;
                            id: string;
                            /** @enum {string} */
                            kind: "message" | "comment" | "system";
                            parentEntryId: string | null;
                            /** @enum {number} */
                            payloadSchemaVersion: 1;
                            reactions: {
                                count: number;
                                /** @enum {string} */
                                reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                                viewerPresent: boolean;
                            }[];
                            rootEventId: string;
                            rootRevision: string;
                            tombstoneReason: ("author" | "moderation") | null;
                            /** Format: date-time */
                            updatedAt: string;
                            version: number;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedReactionsSet: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                entryId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    present: boolean;
                    /** @enum {string} */
                    reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                };
            };
        };
        responses: {
            /** @description Reaction fact stored */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        reaction: {
                            entryId: string;
                            present: boolean;
                            /** @enum {string} */
                            reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                            rootEventId: string;
                            rootRevision: string;
                            /** Format: date-time */
                            updatedAt: string;
                            userId: string;
                            version: number;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedbackList: {
        parameters: {
            query?: {
                cursor?: string;
                followedOnly?: "true" | "false";
                limit?: number;
                status?: "open" | "planned" | "in_progress" | "completed" | "declined";
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Canonical community feedback page */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["CommunityFeedbackSummary"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedbackGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                feedbackId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Canonical community feedback */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["CommunityFeedbackDetail"];
                        redirectedFromFeedbackId: string | null;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedbackCommentsCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                feedbackId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    body: string;
                    id: string;
                };
            };
        };
        responses: {
            /** @description Canonical community comment created */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["CommunityFeedbackDetail"];
                        redirectedFromFeedbackId: string | null;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedbackFollowsSet: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                feedbackId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    followed: boolean;
                };
            };
        };
        responses: {
            /** @description Canonical community follow state stored */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedbackId: string;
                        followed: boolean;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedbackVotesSet: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                feedbackId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    present: boolean;
                };
            };
        };
        responses: {
            /** @description Canonical community vote stored */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["CommunityFeedbackDetail"];
                        redirectedFromFeedbackId: string | null;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedbackDuplicateSuggestionsList: {
        parameters: {
            query: {
                cursor?: string;
                limit?: number;
                q: string;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Privacy-safe likely duplicate suggestions */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["CommunityFeedbackDuplicateSuggestion"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventFeedbackUpdatesList: {
        parameters: {
            query?: {
                cursor?: string;
                followedOnly?: "true" | "false";
                limit?: number;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Community feedback update page */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["CommunityFeedbackUpdate"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventInvitationsList: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sanitized invitation administration page */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["EventInvitationAdminSummary"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventInvitationsCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: date-time */
                    expiresAt: string;
                    id: string;
                    maxUses: number;
                    /**
                     * Format: email
                     * @default null
                     */
                    normalizedEmailHint?: string | null;
                    /** @enum {string} */
                    role: "organizer" | "participant" | "viewer";
                };
            };
        };
        responses: {
            /** @description Invitation created */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        invitation: components["schemas"]["EventInvitation"];
                        token?: string;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventInvitationsRevoke: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                invitationId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                };
            };
        };
        responses: {
            /** @description Invitation revoked */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        invitation: components["schemas"]["EventInvitation"];
                        token?: string;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventItineraryItemsCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default false */
                    allDay?: boolean;
                    details: {
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "note";
                    } | {
                        bookingReference?: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "activity";
                    } | {
                        destinationPlaceId: string;
                        flightDesignator?: string;
                        originPlaceId: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "flight";
                    } | {
                        destinationPlaceId: string;
                        originPlaceId: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        serviceDesignator?: string;
                        /** @enum {string} */
                        type: "rail";
                    } | {
                        destinationPlaceId: string;
                        originPlaceId: string;
                        pickupInstructions?: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "road_transfer";
                    } | {
                        /** Format: date-time */
                        checkInAt: string;
                        /** Format: date-time */
                        checkOutAt: string;
                        propertyName: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "lodging";
                    } | {
                        reservationNote?: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "meal";
                    } | {
                        roundReference: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** Format: date-time */
                        teeTime: string;
                        /** @enum {string} */
                        type: "golf_round";
                    } | {
                        descendantEventId?: string;
                        room?: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        /** @enum {string} */
                        type: "session";
                    };
                    /**
                     * Format: date-time
                     * @default null
                     */
                    endsAt?: string | null;
                    eventId: string;
                    id: string;
                    /** @default null */
                    notes?: string | null;
                    /** @default null */
                    placeId?: string | null;
                    /**
                     * Format: date-time
                     * @default null
                     */
                    startsAt?: string | null;
                    /**
                     * @default active
                     * @enum {string}
                     */
                    status?: "active" | "cancelled" | "archived";
                    timeZone: string;
                    title: string;
                };
            };
        };
        responses: {
            /** @description Itinerary item created */
            201: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        item: components["schemas"]["ItineraryItem"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventItineraryItemsUpdate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                itemId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                    changes: {
                        allDay?: boolean;
                        details?: {
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "note";
                        } | {
                            bookingReference?: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "activity";
                        } | {
                            destinationPlaceId: string;
                            flightDesignator?: string;
                            originPlaceId: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "flight";
                        } | {
                            destinationPlaceId: string;
                            originPlaceId: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            serviceDesignator?: string;
                            /** @enum {string} */
                            type: "rail";
                        } | {
                            destinationPlaceId: string;
                            originPlaceId: string;
                            pickupInstructions?: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "road_transfer";
                        } | {
                            /** Format: date-time */
                            checkInAt: string;
                            /** Format: date-time */
                            checkOutAt: string;
                            propertyName: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "lodging";
                        } | {
                            reservationNote?: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "meal";
                        } | {
                            roundReference: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** Format: date-time */
                            teeTime: string;
                            /** @enum {string} */
                            type: "golf_round";
                        } | {
                            descendantEventId?: string;
                            room?: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "session";
                        };
                        /** Format: date-time */
                        endsAt?: string | null;
                        notes?: string | null;
                        placeId?: string | null;
                        /** Format: date-time */
                        startsAt?: string | null;
                        /** @enum {string} */
                        status?: "active" | "cancelled" | "archived";
                        timeZone?: string;
                        title?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Itinerary item updated */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        item: components["schemas"]["ItineraryItem"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventMemberDirectorySourceGet: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized active member IDs */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                        rootEventId: string;
                        /** @enum {number} */
                        schemaVersion: 1;
                        userIds: string[];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventMembershipsList: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Memberships */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["EventMembership"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventMembershipsUpdate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                    /** @default null */
                    reason?: string | null;
                    /** @enum {string} */
                    role: "organizer" | "participant" | "viewer";
                    /** @enum {string} */
                    status: "active" | "left" | "removed";
                };
            };
        };
        responses: {
            /** @description Membership updated */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        membership: components["schemas"]["EventMembership"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventOwnershipTransfer: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    ownerBaseVersion: number;
                    targetBaseVersion: number;
                    userId: string;
                };
            };
        };
        responses: {
            /** @description Ownership transferred */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        memberships: components["schemas"]["EventMembership"][];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventPlacesList: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Places */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["EventPlace"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventPlacesCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    countryCode: string;
                    id: string;
                    /** @default null */
                    latitude?: number | null;
                    /** @default null */
                    locality?: string | null;
                    /** @default null */
                    longitude?: number | null;
                    name: string;
                };
            };
        };
        responses: {
            /** @description Place created */
            201: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        place: components["schemas"]["EventPlace"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventPlacesUpdate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                placeId: string;
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseVersion: number;
                    changes: {
                        countryCode?: string;
                        latitude?: number | null;
                        locality?: string | null;
                        longitude?: number | null;
                        name?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Place updated */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        place: components["schemas"]["EventPlace"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventsPublish: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description rootRevision returned by the same readiness snapshot. */
                    baseRevision: string;
                    /** @description rootVersion returned by the readiness endpoint. */
                    baseVersion: number;
                };
            };
        };
        responses: {
            /** @description Root event published */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        event: components["schemas"]["Event"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventPublishReadinessGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authoritative publish readiness */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventPublishReadiness"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapsGet: {
        parameters: {
            query?: {
                version?: number;
            };
            header?: never;
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authorized recap projection */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        externalConsent: components["schemas"]["EventRecapExternalConsent"];
                        recap: components["schemas"]["EventRecap"];
                    };
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapsRemove: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseLifecycleVersion: number;
                };
            };
        };
        responses: {
            /** @description Recap removed */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        lifecycleVersion: number;
                        /** @enum {boolean} */
                        removed: true;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapExternalGrantsDecide: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecapExternalGrantDecision"];
            };
        };
        responses: {
            /** @description External recap grant decision appended */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        decision: "grant" | "withdraw";
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapExternalShareLinksCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecapExternalShareCreate"];
            };
        };
        responses: {
            /** @description Exact-field external recap share link created */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        shareLink: components["schemas"]["EventRecapShareLink"];
                        token: string;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapsGenerate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseRevision: string;
                    sources: ({
                        /** @enum {string} */
                        consentBasis: "event-publication";
                        sourceId: string;
                        sourceVersion: number;
                        /** @enum {string} */
                        type: "event";
                    } | {
                        /** @enum {string} */
                        consentBasis: "source-author";
                        sourceId: string;
                        sourceVersion: number;
                        /** @enum {string} */
                        type: "feedEntry";
                    })[];
                };
            };
        };
        responses: {
            /** @description Immutable recap draft generated */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        recap: components["schemas"]["EventRecap"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapsPublish: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseLifecycleVersion: number;
                    recapVersion: number;
                };
            };
        };
        responses: {
            /** @description Recap published */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        recap: components["schemas"]["EventRecap"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapShareLinksCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecapShareCreate"];
            };
        };
        responses: {
            /** @description External recap share link created */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        shareLink: components["schemas"]["EventRecapShareLink"];
                        token: string;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapShareLinksRevoke: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
                shareLinkId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description External recap share link revoked */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        revoked: true;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventTemplateAdopt: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                rootEventId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    baseRevision: string;
                    baseVersion: number;
                    template: {
                        eventIds: {
                            [key: string]: string;
                        };
                        id: string;
                        version: number;
                    };
                };
            };
        };
        responses: {
            /** @description Template adopted atomically */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventTemplateAdoptionResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventTemplatesList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Event templates */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        templates: components["schemas"]["EventTemplate"][];
                    };
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    feedbackCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default [] */
                    attachmentIds?: string[];
                    body: string;
                    diagnostics?: components["schemas"]["FeedbackDiagnostics"] & unknown;
                    /** @default null */
                    eventId?: string | null;
                    id: string;
                    /** @default null */
                    rootEventId?: string | null;
                    /** @default null */
                    screenKey?: string | null;
                    title: string;
                    /** @enum {string} */
                    visibility: "public" | "private";
                };
            };
        };
        responses: {
            /** @description Feedback created */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["Feedback"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    feedbackGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                feedbackId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Feedback */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["Feedback"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    feedbackCommentsCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                feedbackId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    body: string;
                    id: string;
                };
            };
        };
        responses: {
            /** @description Feedback comment created */
            201: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["Feedback"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    feedbackDuplicateMark: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                feedbackId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    canonicalFeedbackId: string;
                    /** @default null */
                    note?: string | null;
                };
            };
        };
        responses: {
            /** @description Feedback marked duplicate */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["Feedback"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    feedbackStatusSet: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                feedbackId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @default null */
                    note?: string | null;
                    /** @enum {string} */
                    status: "open" | "planned" | "in_progress" | "completed" | "declined";
                };
            };
        };
        responses: {
            /** @description Feedback status stored */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["Feedback"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    feedbackVotesSet: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                feedbackId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    present: boolean;
                };
            };
        };
        responses: {
            /** @description Feedback vote stored */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        feedback: components["schemas"]["Feedback"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventInvitationsPreview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description Safe invitation preview */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        emailBound: boolean;
                        /** Format: date-time */
                        endsAt: string | null;
                        /** @enum {string} */
                        role: "organizer" | "participant" | "viewer";
                        rootEventId: string;
                        /** Format: date-time */
                        startsAt: string | null;
                        title: string;
                        usable: boolean;
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventInvitationsRedeem: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description Invitation redeemed */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        membership: components["schemas"]["EventMembership"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Role does not permit this action */
            403: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    placeEnrichmentJobsCreate: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    candidateId: string;
                    /** @enum {string} */
                    target: "candidate";
                } | {
                    countryCode: string;
                    /** @enum {string} */
                    kind: "golf_course" | "venue";
                    query: string;
                    /** @enum {string} */
                    target: "search_miss";
                };
            };
        };
        responses: {
            /** @description Enrichment accepted; use the bounded polling hint */
            202: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        enrichment: components["schemas"]["PlaceEnrichment"];
                        place: components["schemas"]["EnrichedPlace"];
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    placeEnrichmentJobsGet: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Enrichment status */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        enrichment: components["schemas"]["PlaceEnrichment"];
                        place: components["schemas"]["EnrichedPlace"];
                    };
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    placeEnrichmentJobsRetry: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path: {
                jobId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Existing bounded retry accepted */
            202: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Canonical resource URL */
                    Location?: string;
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        enrichment: components["schemas"]["PlaceEnrichment"];
                        place: components["schemas"]["EnrichedPlace"];
                    };
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    placesSearch: {
        parameters: {
            query: {
                countryCode?: string;
                cursor?: string;
                kind?: "golf_course" | "venue";
                limit?: number;
                q: string;
                status?: "pending" | "enriched";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Matching place records */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["PlaceSearchResult"][];
                        pageInfo: {
                            hasMore: boolean;
                            nextCursor: string | null;
                        };
                    };
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Service unavailable */
            503: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapExternalShareLinksResolve: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description Approved exact-field external recap projection */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        recap: components["schemas"]["EventRecapExternalShare"];
                    };
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    eventRecapShareLinksResolve: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: string;
                };
            };
        };
        responses: {
            /** @description Redacted external recap projection */
            200: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        recap: components["schemas"]["EventRecapShare"];
                    };
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Sensitive responses must not be stored by HTTP caches */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    syncBootstrapRead: {
        parameters: {
            query: {
                cursor?: string;
                limit?: number;
                rootEventId: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Immutable root snapshot page */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SyncBootstrapResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Cursor expired */
            410: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    syncChangesList: {
        parameters: {
            query: {
                cursor: string;
                limit?: number;
                rootEventId: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Visible ordered root changes */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SyncPullResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Cursor expired */
            410: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
    syncMutationsApply: {
        parameters: {
            query?: never;
            header: {
                "idempotency-key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    deviceId: string;
                    mutations: ({
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "event.create";
                        payload: {
                            /** @default null */
                            description?: string | null;
                            /**
                             * Format: date-time
                             * @default null
                             */
                            endsAt?: string | null;
                            /** @enum {string} */
                            kind: "trip" | "day" | "golf" | "team_event" | "session" | "activity" | "other";
                            parentEventId: string;
                            /**
                             * Format: date-time
                             * @default null
                             */
                            startsAt?: string | null;
                            /**
                             * @default draft
                             * @enum {string}
                             */
                            status?: "draft" | "published" | "cancelled" | "archived";
                            timeZone: string;
                            title: string;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "team.assignments.publish";
                        payload: {
                            eventId: string;
                            teams: {
                                color: string | null;
                                id: string;
                                memberUserIds: string[];
                                name: string;
                            }[];
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "team.decision.replace";
                        payload: {
                            eventId: string;
                            options: {
                                id: string;
                                label: string;
                            }[];
                            /** @enum {string} */
                            state: "draft" | "open" | "closed";
                            title: string;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "team.response.set";
                        payload: {
                            decisionId: string;
                            eventId: string;
                            optionId: string;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "event.update";
                        payload: {
                            changes: {
                                description?: string | null;
                                /** Format: date-time */
                                endsAt?: string | null;
                                /** Format: date-time */
                                startsAt?: string | null;
                                /** @enum {string} */
                                status?: "draft" | "published" | "cancelled" | "archived";
                                timeZone?: string;
                                title?: string;
                            };
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "event.reparent";
                        payload: {
                            parentEventId: string;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "event.children.reorder";
                        payload: {
                            orderedIds: string[];
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "event.archive";
                        payload: Record<string, never>;
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "event.delete";
                        payload: {
                            /** @default false */
                            subtree?: boolean;
                        };
                    } | {
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "place.create";
                        payload: {
                            countryCode: string;
                            /** @default null */
                            latitude?: number | null;
                            /** @default null */
                            locality?: string | null;
                            /** @default null */
                            longitude?: number | null;
                            name: string;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "place.update";
                        payload: {
                            changes: {
                                countryCode?: string;
                                latitude?: number | null;
                                locality?: string | null;
                                longitude?: number | null;
                                name?: string;
                            };
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "capability.replace";
                        payload: {
                            config: {
                                homePlaceId: string | null;
                                travelerReferenceLabel: string | null;
                            };
                            eventId: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "travel";
                        } | {
                            config: {
                                /** @enum {string} */
                                checkInPolicy: "fixed" | "flexible";
                                /** @enum {string} */
                                checkOutPolicy: "fixed" | "flexible";
                                propertyPlaceId: string | null;
                                /** @enum {string} */
                                roomAssignmentMode: "organizer" | "self_service";
                            };
                            eventId: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "lodging";
                        } | {
                            config: {
                                meetingPlaceId: string | null;
                                /** @enum {string} */
                                participantMode: "self_arranged" | "shared" | "mixed";
                            };
                            eventId: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "transport";
                        } | {
                            config: {
                                coursePlaceId: string | null;
                                /** @enum {string} */
                                handicapMode: "none" | "optional" | "required";
                                /** @enum {string} */
                                roundState: "planned" | "open" | "closed";
                                /** @enum {string} */
                                scoringMode: "none" | "stroke_play" | "stableford";
                                /** @enum {string} */
                                teeFormat: "individual" | "pairs" | "fourball";
                            };
                            eventId: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "golf";
                        } | {
                            config: {
                                /** @enum {string} */
                                assignmentMode: "organizer" | "self_select" | "random";
                                capacityPerTeam: number | null;
                                facilitator: string | null;
                                venuePlaceId: string | null;
                            };
                            eventId: string;
                            /** @enum {number} */
                            schemaVersion: 1;
                            /** @enum {string} */
                            type: "team";
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "capability.remove";
                        payload: {
                            eventId: string;
                            /** @enum {string} */
                            type: "travel" | "lodging" | "transport" | "golf" | "team";
                        };
                    } | {
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "itinerary.create";
                        payload: {
                            /** @default false */
                            allDay?: boolean;
                            details: {
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** @enum {string} */
                                type: "note";
                            } | {
                                bookingReference?: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** @enum {string} */
                                type: "activity";
                            } | {
                                destinationPlaceId: string;
                                flightDesignator?: string;
                                originPlaceId: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** @enum {string} */
                                type: "flight";
                            } | {
                                destinationPlaceId: string;
                                originPlaceId: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                serviceDesignator?: string;
                                /** @enum {string} */
                                type: "rail";
                            } | {
                                destinationPlaceId: string;
                                originPlaceId: string;
                                pickupInstructions?: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** @enum {string} */
                                type: "road_transfer";
                            } | {
                                /** Format: date-time */
                                checkInAt: string;
                                /** Format: date-time */
                                checkOutAt: string;
                                propertyName: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** @enum {string} */
                                type: "lodging";
                            } | {
                                reservationNote?: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** @enum {string} */
                                type: "meal";
                            } | {
                                roundReference: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** Format: date-time */
                                teeTime: string;
                                /** @enum {string} */
                                type: "golf_round";
                            } | {
                                descendantEventId?: string;
                                room?: string;
                                /** @enum {number} */
                                schemaVersion: 1;
                                /** @enum {string} */
                                type: "session";
                            };
                            /**
                             * Format: date-time
                             * @default null
                             */
                            endsAt?: string | null;
                            eventId: string;
                            /** @default null */
                            notes?: string | null;
                            /** @default null */
                            placeId?: string | null;
                            /**
                             * Format: date-time
                             * @default null
                             */
                            startsAt?: string | null;
                            /**
                             * @default active
                             * @enum {string}
                             */
                            status?: "active" | "cancelled" | "archived";
                            timeZone: string;
                            title: string;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "itinerary.update";
                        payload: {
                            changes: {
                                allDay?: boolean;
                                details?: {
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** @enum {string} */
                                    type: "note";
                                } | {
                                    bookingReference?: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** @enum {string} */
                                    type: "activity";
                                } | {
                                    destinationPlaceId: string;
                                    flightDesignator?: string;
                                    originPlaceId: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** @enum {string} */
                                    type: "flight";
                                } | {
                                    destinationPlaceId: string;
                                    originPlaceId: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    serviceDesignator?: string;
                                    /** @enum {string} */
                                    type: "rail";
                                } | {
                                    destinationPlaceId: string;
                                    originPlaceId: string;
                                    pickupInstructions?: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** @enum {string} */
                                    type: "road_transfer";
                                } | {
                                    /** Format: date-time */
                                    checkInAt: string;
                                    /** Format: date-time */
                                    checkOutAt: string;
                                    propertyName: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** @enum {string} */
                                    type: "lodging";
                                } | {
                                    reservationNote?: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** @enum {string} */
                                    type: "meal";
                                } | {
                                    roundReference: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** Format: date-time */
                                    teeTime: string;
                                    /** @enum {string} */
                                    type: "golf_round";
                                } | {
                                    descendantEventId?: string;
                                    room?: string;
                                    /** @enum {number} */
                                    schemaVersion: 1;
                                    /** @enum {string} */
                                    type: "session";
                                };
                                /** Format: date-time */
                                endsAt?: string | null;
                                notes?: string | null;
                                placeId?: string | null;
                                /** Format: date-time */
                                startsAt?: string | null;
                                /** @enum {string} */
                                status?: "active" | "cancelled" | "archived";
                                timeZone?: string;
                                title?: string;
                            };
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "itinerary.reorder";
                        payload: {
                            orderedIds: string[];
                        };
                    } | {
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "feed.entry.create";
                        payload: {
                            content: string;
                            /** @default null */
                            eventId?: string | null;
                            /**
                             * @default message
                             * @enum {string}
                             */
                            kind?: "message" | "comment";
                            /** @default null */
                            parentEntryId?: string | null;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "feed.entry.revise";
                        payload: {
                            content: string;
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "feed.entry.remove";
                        payload: Record<string, never>;
                    } | {
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "feed.reaction.set";
                        payload: {
                            present: boolean;
                            /** @enum {string} */
                            reaction: "like" | "love" | "celebrate" | "laugh" | "surprised" | "sad";
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "golf.round.replace";
                        payload: {
                            eventId: string;
                            holes: {
                                hole: number;
                                par: number;
                                strokeIndex: number;
                            }[];
                            players: {
                                playingHandicap: number;
                                userId: string;
                            }[];
                            teams: {
                                color: string | null;
                                id: string;
                                memberUserIds: string[];
                                name: string;
                            }[];
                        };
                    } | {
                        baseVersion: number;
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "golf.score.set";
                        payload: {
                            eventId: string;
                            hole: number;
                            putts: number | null;
                            strokes: number | null;
                        };
                    } | {
                        /** Format: uuid */
                        clientMutationId: string;
                        clientSequence: number;
                        entityId: string;
                        /** @enum {string} */
                        kind: "attachment.commit";
                        payload: {
                            /** @default null */
                            caption?: string | null;
                            uploadId: string;
                        };
                    })[];
                    /** @enum {number} */
                    protocolVersion: 1;
                    rootEventId: string;
                };
            };
        };
        responses: {
            /** @description Per-mutation sync outcomes */
            200: {
                headers: {
                    /** @description True when the stored idempotent response was replayed */
                    "Idempotency-Replayed"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SyncPushResponse"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Authentication required */
            401: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    /** @description Seconds until the request may be retried */
                    "Retry-After"?: string;
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Payload too large */
            413: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Unexpected failure */
            500: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
        };
    };
}
