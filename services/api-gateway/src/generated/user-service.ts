/**
 * Generated from contracts/user-service.openapi.json.
 * Pin: sha256:333a09d9e104cb54aa83aa83cb52a1ff10f1bd2f59f910ab78cf7ce6be666d55
 * Generator: openapi-typescript 7.13.0. Do not edit.
 */
export type paths = {
    "/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Revoke the current refresh-session family */
        post: operations["identitySessionsRevoke"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/magic-links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Send a one-time sign-in link */
        post: operations["identityMagicLinksCreate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/magic-links/redeem": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redeem a one-time sign-in link */
        post: operations["identityMagicLinksRedeem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rotate a refresh token and issue a new session */
        post: operations["identitySessionsRefresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get the authenticated user's profile */
        get: operations["usersMeGet"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update the authenticated user's profile */
        patch: operations["usersMeUpdate"];
        trace?: never;
    };
    "/v1/me/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the authenticated user's devices */
        get: operations["usersDevicesList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/devices/{installationId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Register or refresh one installation */
        put: operations["usersDevicesUpsert"];
        post?: never;
        /** Remove one of the authenticated user's installations */
        delete: operations["usersDevicesDelete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/member-directory-profiles/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Resolve a bounded active-member page to public display fields */
        post: operations["usersMemberDirectoryProfilesResolve"];
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
        Device: {
            appVersion: string;
            id: string;
            installationId: string;
            locale: string;
            notificationsEnabled: boolean;
            /** @enum {string} */
            platform: "ios" | "android";
            timeZone: string;
            /** Format: date-time */
            updatedAt: string;
        };
        ErrorDetail: {
            code: string;
            message: string;
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
        MemberDirectoryProfile: {
            displayName: string | null;
            profileVersion: number;
            userId: string;
        };
        Profile: {
            /** Format: uri */
            avatarUrl: string | null;
            displayName: string | null;
            eventReminders: boolean;
            locale: string;
            productUpdates: boolean;
            reduceMotion: boolean;
            timeZone: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        Session: {
            accessToken: string;
            expiresInSeconds: number;
            refreshToken: string;
            /** @enum {string} */
            tokenType: "Bearer";
            user: components["schemas"]["User"];
        };
        User: {
            /** Format: email */
            email: string;
            id: string;
            profile: components["schemas"]["Profile"];
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
    identitySessionsRevoke: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session revoked */
            204: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content?: never;
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
    identityMagicLinksCreate: {
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
                    /** Format: email */
                    email: string;
                };
            };
        };
        responses: {
            /** @description Request accepted without revealing account existence */
            202: {
                headers: {
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {boolean} */
                        accepted: true;
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
            /** @description Idempotency conflict */
            409: {
                headers: {
                    /** @description Seconds until this request may be retried */
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
            /** @description Rate limited */
            429: {
                headers: {
                    /** @description Seconds until this request may be retried */
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
    identityMagicLinksRedeem: {
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
            /** @description Authenticated session */
            200: {
                headers: {
                    /** @description Prevents storage of credential and private-profile responses */
                    "Cache-Control"?: "private, no-store";
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
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
            /** @description Link invalid, expired, or already consumed */
            401: {
                headers: {
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Idempotency conflict */
            409: {
                headers: {
                    /** @description Seconds until this request may be retried */
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
            /** @description Rate limited */
            429: {
                headers: {
                    /** @description Seconds until this request may be retried */
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
    identitySessionsRefresh: {
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
                    refreshToken: string;
                };
            };
        };
        responses: {
            /** @description Rotated session */
            200: {
                headers: {
                    /** @description Prevents storage of credential and private-profile responses */
                    "Cache-Control"?: "private, no-store";
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
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
            /** @description Refresh token invalid or session family revoked */
            401: {
                headers: {
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorEnvelope"];
                };
            };
            /** @description Idempotency conflict */
            409: {
                headers: {
                    /** @description Seconds until this request may be retried */
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
            /** @description Rate limited */
            429: {
                headers: {
                    /** @description Seconds until this request may be retried */
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
    usersMeGet: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Authenticated user */
            200: {
                headers: {
                    /** @description Prevents storage of credential and private-profile responses */
                    "Cache-Control"?: "private, no-store";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
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
            /** @description User not found */
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
    usersMeUpdate: {
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
                    baseVersion: number;
                    changes: {
                        /** Format: uri */
                        avatarUrl?: string | null;
                        displayName?: string | null;
                        eventReminders?: boolean;
                        locale?: string;
                        productUpdates?: boolean;
                        reduceMotion?: boolean;
                        timeZone?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Updated profile */
            200: {
                headers: {
                    /** @description Prevents storage of credential and private-profile responses */
                    "Cache-Control"?: "private, no-store";
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Profile"];
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
            /** @description Profile version or idempotency conflict */
            409: {
                headers: {
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Seconds until this request may be retried */
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
    usersDevicesList: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Registered devices */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Device"][];
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
    usersDevicesUpsert: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installationId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    appVersion: string;
                    locale: string;
                    notificationsEnabled: boolean;
                    /** @enum {string} */
                    platform: "ios" | "android";
                    pushToken: string | null;
                    timeZone: string;
                };
            };
        };
        responses: {
            /** @description Registered device */
            200: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Device"];
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
    usersDevicesDelete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                installationId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Device removed or already absent */
            204: {
                headers: {
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content?: never;
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
    usersMemberDirectoryProfilesResolve: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    rootEventId: string;
                    /** @enum {number} */
                    schemaVersion: 1;
                    userIds: string[];
                };
            };
        };
        responses: {
            /** @description Exact ordered profile set */
            200: {
                headers: {
                    /** @description Prevents storage of credential and private-profile responses */
                    "Cache-Control"?: "private, no-store";
                    /** @description Present with value true when a completed response is replayed */
                    "Idempotency-Replayed"?: "true";
                    /** @description Crew request correlation identifier */
                    "X-Request-ID"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        profiles: components["schemas"]["MemberDirectoryProfile"][];
                        rootEventId: string;
                        /** @enum {number} */
                        schemaVersion: 1;
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
            /** @description Service authentication required */
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
            /** @description Profile set incomplete */
            409: {
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
