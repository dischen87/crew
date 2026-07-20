/**
 * Generated from contracts/gateway.openapi.json.
 * Pin: sha256:15b983ac9ca1857a34861c173a5f04776e94ccf9e5a60035eead6e1bd99a42df. Do not edit.
 */
export type GatewayOperationId = "eventAttachmentsDownload" | "eventAttachmentUploadsFinalize" | "eventAttachmentUploadsPrepare" | "eventCapabilitiesRemove" | "eventCapabilitiesReplace" | "eventChildrenCreate" | "eventChildrenReorder" | "eventFeedbackCommentsCreate" | "eventFeedbackDuplicateSuggestionsList" | "eventFeedbackFollowsSet" | "eventFeedbackGet" | "eventFeedbackList" | "eventFeedbackUpdatesList" | "eventFeedbackVotesSet" | "eventFeedEntriesCreate" | "eventFeedEntriesGet" | "eventFeedEntriesList" | "eventFeedEntriesRemove" | "eventFeedEntriesRevise" | "eventFeedReactionsSet" | "eventInvitationsCreate" | "eventInvitationsList" | "eventInvitationsPreview" | "eventInvitationsRedeem" | "eventInvitationsRevoke" | "eventItineraryItemsCreate" | "eventItineraryItemsList" | "eventItineraryItemsReorder" | "eventItineraryItemsUpdate" | "eventMemberDirectoryGet" | "eventMembershipsList" | "eventMembershipsUpdate" | "eventOwnershipTransfer" | "eventPlacesCreate" | "eventPlacesList" | "eventPlacesUpdate" | "eventPublishReadinessGet" | "eventRecapExternalGrantsDecide" | "eventRecapExternalShareLinksCreate" | "eventRecapExternalShareLinksResolve" | "eventRecapsGenerate" | "eventRecapsGet" | "eventRecapShareLinksCreate" | "eventRecapShareLinksResolve" | "eventRecapShareLinksRevoke" | "eventRecapsPublish" | "eventRecapsRemove" | "eventRootsList" | "eventsArchive" | "eventsCreate" | "eventsDelete" | "eventsGet" | "eventsPublish" | "eventsReparent" | "eventsTreeGet" | "eventsUpdate" | "eventTemplateAdopt" | "eventTemplatesList" | "feedbackCommentsCreate" | "feedbackCreate" | "feedbackDuplicateMark" | "feedbackGet" | "feedbackStatusSet" | "feedbackVotesSet" | "identityMagicLinksCreate" | "identityMagicLinksRedeem" | "identitySessionsRefresh" | "identitySessionsRevoke" | "placeEnrichmentJobsCreate" | "placeEnrichmentJobsGet" | "placeEnrichmentJobsRetry" | "placesSearch" | "syncBootstrapRead" | "syncChangesList" | "syncMutationsApply" | "usersDevicesDelete" | "usersDevicesList" | "usersDevicesUpsert" | "usersMeGet" | "usersMeUpdate" | "usersSessionGet";

export interface GatewayJsonSchema {
	readonly $ref?: string;
	readonly additionalProperties?: boolean | GatewayJsonSchema;
	readonly anyOf?: readonly GatewayJsonSchema[];
	readonly const?: unknown;
	readonly enum?: readonly unknown[];
	readonly exclusiveMaximum?: number;
	readonly exclusiveMinimum?: number;
	readonly format?: string;
	readonly items?: GatewayJsonSchema;
	readonly maxItems?: number;
	readonly maxLength?: number;
	readonly maximum?: number;
	readonly minItems?: number;
	readonly minLength?: number;
	readonly minimum?: number;
	readonly oneOf?: readonly GatewayJsonSchema[];
	readonly pattern?: string;
	readonly properties?: Readonly<Record<string, GatewayJsonSchema>>;
	readonly required?: readonly string[];
	readonly type?: string | readonly string[];
}

export interface GatewaySuccessResponse {
	readonly status: number;
	readonly contentType: "application/json" | null;
	readonly schema?: GatewayJsonSchema;
}

export interface GatewayRoute {
	readonly operationId: GatewayOperationId;
	readonly method: string;
	readonly path: string;
	readonly auth: "public" | "required";
	readonly idempotency: "none" | "required";
	readonly pathParameters: readonly string[];
	readonly queryParameters: readonly string[];
	readonly headerParameters: readonly string[];
	readonly hasJsonBody: boolean;
	readonly successResponses: readonly GatewaySuccessResponse[];
}

export const gatewaySchemas: Readonly<Record<string, GatewayJsonSchema>> = {
  "EventServiceAttachmentTarget": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "feedEntry"
            ]
          },
          "entryId": {
            "type": "string",
            "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
          }
        },
        "required": [
          "kind",
          "entryId"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "feedback"
            ]
          },
          "feedbackId": {
            "type": "string",
            "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
          }
        },
        "required": [
          "kind",
          "feedbackId"
        ],
        "additionalProperties": false
      }
    ]
  },
  "EventServiceCommunityFeedbackComment": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^fbc_[A-Za-z0-9._:-]{1,96}$"
      },
      "body": {
        "type": "string",
        "minLength": 1,
        "maxLength": 5000
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "body",
      "createdAt"
    ],
    "additionalProperties": false
  },
  "EventServiceCommunityFeedbackDetail": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "body": {
        "type": "string",
        "minLength": 1,
        "maxLength": 10000
      },
      "status": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 1000
      },
      "voteCount": {
        "type": "integer",
        "minimum": 0
      },
      "duplicateCount": {
        "type": "integer",
        "minimum": 0
      },
      "viewerHasVoted": {
        "type": "boolean"
      },
      "followed": {
        "type": "boolean"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "comments": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceCommunityFeedbackComment"
        },
        "maxItems": 20
      },
      "commentCount": {
        "type": "integer",
        "minimum": 0
      },
      "commentsHasMore": {
        "type": "boolean"
      },
      "statusHistory": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceCommunityFeedbackStatusChange"
        },
        "maxItems": 20
      },
      "statusHistoryCount": {
        "type": "integer",
        "minimum": 0
      },
      "statusHistoryHasMore": {
        "type": "boolean"
      }
    },
    "required": [
      "id",
      "title",
      "body",
      "status",
      "version",
      "voteCount",
      "duplicateCount",
      "viewerHasVoted",
      "followed",
      "createdAt",
      "updatedAt",
      "comments",
      "commentCount",
      "commentsHasMore",
      "statusHistory",
      "statusHistoryCount",
      "statusHistoryHasMore"
    ],
    "additionalProperties": false
  },
  "EventServiceCommunityFeedbackDuplicateSuggestion": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "status": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined"
        ]
      },
      "voteCount": {
        "type": "integer",
        "minimum": 0
      }
    },
    "required": [
      "id",
      "title",
      "status",
      "voteCount"
    ],
    "additionalProperties": false
  },
  "EventServiceCommunityFeedbackStatusChange": {
    "type": "object",
    "properties": {
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 1000
      },
      "fromStatus": {
        "anyOf": [
          {
            "type": "string",
            "enum": [
              "open",
              "planned",
              "in_progress",
              "completed",
              "declined"
            ]
          },
          {
            "type": "null"
          },
          {
            "type": "null"
          }
        ]
      },
      "toStatus": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined"
        ]
      },
      "note": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 1000
      },
      "changedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "version",
      "fromStatus",
      "toStatus",
      "note",
      "changedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceCommunityFeedbackSummary": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "body": {
        "type": "string",
        "minLength": 1,
        "maxLength": 10000
      },
      "status": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 1000
      },
      "voteCount": {
        "type": "integer",
        "minimum": 0
      },
      "duplicateCount": {
        "type": "integer",
        "minimum": 0
      },
      "viewerHasVoted": {
        "type": "boolean"
      },
      "followed": {
        "type": "boolean"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "title",
      "body",
      "status",
      "version",
      "voteCount",
      "duplicateCount",
      "viewerHasVoted",
      "followed",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceCommunityFeedbackUpdate": {
    "type": "object",
    "properties": {
      "feedbackId": {
        "type": "string",
        "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 1000
      },
      "fromStatus": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined"
        ]
      },
      "toStatus": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined"
        ]
      },
      "note": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 1000
      },
      "changedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "feedbackId",
      "title",
      "version",
      "fromStatus",
      "toStatus",
      "note",
      "changedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceEnrichedPlace": {
    "type": [
      "object",
      "null"
    ],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^gpl_[a-f0-9]{64}$"
      },
      "sourceCandidateId": {
        "type": "string",
        "pattern": "^pcd_[a-f0-9]{64}$"
      },
      "kind": {
        "type": "string",
        "enum": [
          "golf_course",
          "venue"
        ]
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "locality": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 200
      },
      "region": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 200
      },
      "countryCode": {
        "type": "string",
        "pattern": "^[A-Z]{2}$"
      },
      "latitude": {
        "type": [
          "number",
          "null"
        ],
        "minimum": -90,
        "maximum": 90
      },
      "longitude": {
        "type": [
          "number",
          "null"
        ],
        "minimum": -180,
        "maximum": 180
      },
      "address": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 500
      },
      "websiteUrl": {
        "type": [
          "string",
          "null"
        ],
        "maxLength": 2048,
        "format": "uri"
      },
      "summary": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 1000
      }
    },
    "required": [
      "id",
      "sourceCandidateId",
      "kind",
      "name",
      "locality",
      "region",
      "countryCode",
      "latitude",
      "longitude",
      "address",
      "websiteUrl",
      "summary"
    ],
    "additionalProperties": false
  },
  "EventServiceEvent": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "parentEventId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "kind": {
        "type": "string",
        "enum": [
          "trip",
          "day",
          "golf",
          "team_event",
          "session",
          "activity",
          "other"
        ]
      },
      "title": {
        "type": "string"
      },
      "description": {
        "type": [
          "string",
          "null"
        ]
      },
      "timeZone": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "startsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "endsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "sortKey": {
        "type": "string",
        "pattern": "^[1-9]\\d*$"
      },
      "childOrderVersion": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "itineraryOrderVersion": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "published",
          "cancelled",
          "archived"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "parentEventId",
      "kind",
      "title",
      "description",
      "timeZone",
      "startsAt",
      "endsAt",
      "sortKey",
      "childOrderVersion",
      "itineraryOrderVersion",
      "status",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceEventCapability": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "travel"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "homePlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "travelerReferenceLabel": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 120
              }
            },
            "required": [
              "homePlaceId",
              "travelerReferenceLabel"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "lodging"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "propertyPlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "checkInPolicy": {
                "type": "string",
                "enum": [
                  "fixed",
                  "flexible"
                ]
              },
              "checkOutPolicy": {
                "type": "string",
                "enum": [
                  "fixed",
                  "flexible"
                ]
              },
              "roomAssignmentMode": {
                "type": "string",
                "enum": [
                  "organizer",
                  "self_service"
                ]
              }
            },
            "required": [
              "propertyPlaceId",
              "checkInPolicy",
              "checkOutPolicy",
              "roomAssignmentMode"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "transport"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "meetingPlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "participantMode": {
                "type": "string",
                "enum": [
                  "self_arranged",
                  "shared",
                  "mixed"
                ]
              }
            },
            "required": [
              "meetingPlaceId",
              "participantMode"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "golf"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "coursePlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "teeFormat": {
                "type": "string",
                "enum": [
                  "individual",
                  "pairs",
                  "fourball"
                ]
              },
              "handicapMode": {
                "type": "string",
                "enum": [
                  "none",
                  "optional",
                  "required"
                ]
              },
              "scoringMode": {
                "type": "string",
                "enum": [
                  "none",
                  "stroke_play",
                  "stableford"
                ]
              },
              "roundState": {
                "type": "string",
                "enum": [
                  "planned",
                  "open",
                  "closed"
                ]
              }
            },
            "required": [
              "coursePlaceId",
              "teeFormat",
              "handicapMode",
              "scoringMode",
              "roundState"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "team"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "venuePlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "assignmentMode": {
                "type": "string",
                "enum": [
                  "organizer",
                  "self_select",
                  "random"
                ]
              },
              "capacityPerTeam": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 1,
                "maximum": 1000
              },
              "facilitator": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 160
              }
            },
            "required": [
              "venuePlaceId",
              "assignmentMode",
              "capacityPerTeam",
              "facilitator"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt"
        ],
        "additionalProperties": false
      }
    ]
  },
  "EventServiceEventInvitation": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^inv_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "role": {
        "type": "string",
        "enum": [
          "organizer",
          "participant",
          "viewer"
        ]
      },
      "normalizedEmailHint": {
        "type": [
          "string",
          "null"
        ],
        "format": "email"
      },
      "expiresAt": {
        "type": "string",
        "format": "date-time"
      },
      "maxUses": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "useCount": {
        "type": "integer",
        "minimum": 0
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "revoked"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "role",
      "normalizedEmailHint",
      "expiresAt",
      "maxUses",
      "useCount",
      "status",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceEventInvitationAdminSummary": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^inv_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "role": {
        "type": "string",
        "enum": [
          "organizer",
          "participant",
          "viewer"
        ]
      },
      "emailBound": {
        "type": "boolean"
      },
      "expiresAt": {
        "type": "string",
        "format": "date-time"
      },
      "maxUses": {
        "type": "integer",
        "minimum": 1,
        "maximum": 10000
      },
      "useCount": {
        "type": "integer",
        "minimum": 0
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "revoked"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "role",
      "emailBound",
      "expiresAt",
      "maxUses",
      "useCount",
      "status",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceEventMembership": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "role": {
        "type": "string",
        "enum": [
          "owner",
          "organizer",
          "participant",
          "viewer"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "left",
          "removed"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "rootEventId",
      "userId",
      "role",
      "status",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceEventPlace": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "name": {
        "type": "string"
      },
      "locality": {
        "type": [
          "string",
          "null"
        ]
      },
      "countryCode": {
        "type": "string",
        "minLength": 2,
        "maxLength": 2
      },
      "latitude": {
        "type": [
          "number",
          "null"
        ]
      },
      "longitude": {
        "type": [
          "number",
          "null"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "name",
      "locality",
      "countryCode",
      "latitude",
      "longitude",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceEventPublishReadiness": {
    "type": "object",
    "properties": {
      "schemaVersion": {
        "type": "number",
        "enum": [
          1
        ]
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootVersion": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "rootRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "template": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "id": {
            "type": "string",
            "enum": [
              "travel",
              "golf-tour",
              "team-event"
            ]
          },
          "version": {
            "type": "number",
            "enum": [
              1
            ]
          }
        },
        "required": [
          "id",
          "version"
        ],
        "additionalProperties": false
      },
      "ready": {
        "type": "boolean"
      },
      "reasons": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceEventPublishReadinessReason"
        },
        "maxItems": 2508
      }
    },
    "required": [
      "schemaVersion",
      "rootEventId",
      "rootVersion",
      "rootRevision",
      "template",
      "ready",
      "reasons"
    ],
    "additionalProperties": false
  },
  "EventServiceEventPublishReadinessReason": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "enum": [
          "EVENT_TEMPLATE_REQUIRED",
          "EVENT_TITLE_REQUIRED",
          "EVENT_DESCRIPTION_REQUIRED",
          "EVENT_START_REQUIRED",
          "EVENT_END_REQUIRED",
          "EVENT_CAPABILITY_REQUIRED",
          "EVENT_CAPABILITY_PLACE_REQUIRED",
          "EVENT_STATUS_NOT_DRAFT"
        ]
      },
      "path": {
        "type": "string",
        "minLength": 1,
        "maxLength": 300
      },
      "message": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "meta": {
        "type": "object",
        "properties": {
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "capabilityType": {
            "type": "string",
            "enum": [
              "travel",
              "lodging",
              "transport",
              "golf",
              "team"
            ]
          }
        },
        "additionalProperties": false
      }
    },
    "required": [
      "code",
      "path",
      "message"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecap": {
    "type": "object",
    "properties": {
      "schemaVersion": {
        "type": "number",
        "enum": [
          1
        ]
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 2147483647
      },
      "lifecycleVersion": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 2147483647
      },
      "state": {
        "type": "string",
        "enum": [
          "draft",
          "published"
        ]
      },
      "publishedVersion": {
        "type": [
          "integer",
          "null"
        ],
        "exclusiveMinimum": 0,
        "maximum": 2147483647
      },
      "sourceRootRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "generatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "publishedAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "titleProvenance": {
        "type": "object",
        "properties": {
          "sourceType": {
            "type": "string",
            "enum": [
              "event"
            ]
          },
          "sourceId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "sourceVersion": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 2147483647
          },
          "sourceRevision": {
            "type": "string",
            "pattern": "^(0|[1-9]\\d*)$"
          },
          "visibility": {
            "type": "string",
            "enum": [
              "members"
            ]
          },
          "consentBasis": {
            "type": "string",
            "enum": [
              "event-publication"
            ]
          }
        },
        "required": [
          "sourceType",
          "sourceId",
          "sourceVersion",
          "sourceRevision",
          "visibility",
          "consentBasis"
        ],
        "additionalProperties": false
      },
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceEventRecapItem"
        },
        "maxItems": 50
      }
    },
    "required": [
      "schemaVersion",
      "rootEventId",
      "version",
      "lifecycleVersion",
      "state",
      "publishedVersion",
      "sourceRootRevision",
      "generatedAt",
      "publishedAt",
      "title",
      "titleProvenance",
      "items"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecapExternalConsent": {
    "type": [
      "object",
      "null"
    ],
    "properties": {
      "fields": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceEventRecapExternalConsentField"
        },
        "maxItems": 50
      }
    },
    "required": [
      "fields"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecapExternalConsentField": {
    "type": "object",
    "properties": {
      "ordinal": {
        "type": "integer",
        "minimum": 0,
        "maximum": 49
      },
      "field": {
        "type": "string",
        "enum": [
          "body"
        ]
      },
      "requiredAuthorities": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "author",
            "manager"
          ]
        },
        "minItems": 1,
        "maxItems": 2
      },
      "authorDecision": {
        "type": "string",
        "enum": [
          "grant",
          "withdraw",
          "unknown"
        ]
      },
      "managerDecision": {
        "type": "string",
        "enum": [
          "grant",
          "withdraw",
          "unknown"
        ]
      },
      "actorCanDecide": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "author",
            "manager"
          ]
        },
        "maxItems": 2
      }
    },
    "required": [
      "ordinal",
      "field",
      "requiredAuthorities",
      "authorDecision",
      "managerDecision",
      "actorCanDecide"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecapExternalShare": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceEventRecapExternalShareItem"
        },
        "maxItems": 50
      }
    },
    "required": [
      "title",
      "items"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecapExternalShareItem": {
    "anyOf": [
      {
        "type": "object",
        "properties": {
          "ordinal": {
            "type": "integer",
            "minimum": 0,
            "maximum": 49
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160
          },
          "body": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 1,
            "maxLength": 5000
          }
        },
        "required": [
          "ordinal",
          "title",
          "body"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "ordinal": {
            "type": "integer",
            "minimum": 0,
            "maximum": 49
          },
          "title": {
            "type": "null"
          },
          "body": {
            "type": "string",
            "minLength": 1,
            "maxLength": 5000
          }
        },
        "required": [
          "ordinal",
          "title",
          "body"
        ],
        "additionalProperties": false
      }
    ]
  },
  "EventServiceEventRecapItem": {
    "type": "object",
    "properties": {
      "ordinal": {
        "type": "integer",
        "minimum": 0,
        "maximum": 49
      },
      "sourceTitle": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 160
      },
      "sourceBody": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 5000
      },
      "provenance": {
        "$ref": "#/components/schemas/EventServiceEventRecapProvenance"
      }
    },
    "required": [
      "ordinal",
      "sourceTitle",
      "sourceBody",
      "provenance"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecapProvenance": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "sourceType": {
            "type": "string",
            "enum": [
              "event"
            ]
          },
          "sourceId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "sourceVersion": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 2147483647
          },
          "sourceRevision": {
            "type": "string",
            "pattern": "^(0|[1-9]\\d*)$"
          },
          "visibility": {
            "type": "string",
            "enum": [
              "members"
            ]
          },
          "consentBasis": {
            "type": "string",
            "enum": [
              "event-publication"
            ]
          }
        },
        "required": [
          "sourceType",
          "sourceId",
          "sourceVersion",
          "sourceRevision",
          "visibility",
          "consentBasis"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "sourceType": {
            "type": "string",
            "enum": [
              "feedEntry"
            ]
          },
          "sourceId": {
            "type": "string",
            "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
          },
          "sourceVersion": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 2147483647
          },
          "sourceRevision": {
            "type": "string",
            "pattern": "^(0|[1-9]\\d*)$"
          },
          "visibility": {
            "type": "string",
            "enum": [
              "members"
            ]
          },
          "consentBasis": {
            "type": "string",
            "enum": [
              "source-author"
            ]
          }
        },
        "required": [
          "sourceType",
          "sourceId",
          "sourceVersion",
          "sourceRevision",
          "visibility",
          "consentBasis"
        ],
        "additionalProperties": false
      }
    ]
  },
  "EventServiceEventRecapShare": {
    "type": "object",
    "properties": {
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "items": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceEventRecapShareItem"
        },
        "maxItems": 50
      }
    },
    "required": [
      "title",
      "items"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecapShareItem": {
    "type": "object",
    "properties": {
      "ordinal": {
        "type": "integer",
        "minimum": 0,
        "maximum": 49
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      }
    },
    "required": [
      "ordinal",
      "title"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRecapShareLink": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^rsh_[A-Za-z0-9_-]{24}$"
      },
      "recapVersion": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 2147483647
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "expiresAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "recapVersion",
      "createdAt",
      "expiresAt"
    ],
    "additionalProperties": false
  },
  "EventServiceEventRootSummary": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "kind": {
        "type": "string",
        "enum": [
          "trip",
          "day",
          "golf",
          "team_event",
          "session",
          "activity",
          "other"
        ]
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "timeZone": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "startsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "endsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "published",
          "cancelled",
          "archived"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "role": {
        "type": "string",
        "enum": [
          "owner",
          "organizer",
          "participant",
          "viewer"
        ]
      },
      "membershipStatus": {
        "type": "string",
        "enum": [
          "active",
          "left",
          "removed"
        ]
      }
    },
    "required": [
      "rootEventId",
      "kind",
      "title",
      "timeZone",
      "startsAt",
      "endsAt",
      "status",
      "version",
      "createdAt",
      "updatedAt",
      "role",
      "membershipStatus"
    ],
    "additionalProperties": false
  },
  "EventServiceEventTemplate": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "enum": [
          "travel",
          "golf-tour",
          "team-event"
        ]
      },
      "version": {
        "type": "number",
        "enum": [
          1
        ]
      },
      "title": {
        "type": "string"
      },
      "summary": {
        "type": "string"
      },
      "events": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "logicalKey": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9-]{0,31}$"
            },
            "parentLogicalKey": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^[a-z][a-z0-9-]{0,31}$"
            },
            "kind": {
              "type": "string",
              "enum": [
                "trip",
                "day",
                "golf",
                "team_event",
                "session",
                "activity",
                "other"
              ]
            },
            "title": {
              "type": "string"
            },
            "capabilities": {
              "type": "array",
              "items": {
                "oneOf": [
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "travel"
                        ]
                      },
                      "schemaVersion": {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      "config": {
                        "type": "object",
                        "properties": {
                          "homePlaceId": {
                            "type": [
                              "string",
                              "null"
                            ],
                            "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                          },
                          "travelerReferenceLabel": {
                            "type": [
                              "string",
                              "null"
                            ],
                            "minLength": 1,
                            "maxLength": 120
                          }
                        },
                        "required": [
                          "homePlaceId",
                          "travelerReferenceLabel"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "type",
                      "schemaVersion",
                      "config"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "lodging"
                        ]
                      },
                      "schemaVersion": {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      "config": {
                        "type": "object",
                        "properties": {
                          "propertyPlaceId": {
                            "type": [
                              "string",
                              "null"
                            ],
                            "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                          },
                          "checkInPolicy": {
                            "type": "string",
                            "enum": [
                              "fixed",
                              "flexible"
                            ]
                          },
                          "checkOutPolicy": {
                            "type": "string",
                            "enum": [
                              "fixed",
                              "flexible"
                            ]
                          },
                          "roomAssignmentMode": {
                            "type": "string",
                            "enum": [
                              "organizer",
                              "self_service"
                            ]
                          }
                        },
                        "required": [
                          "propertyPlaceId",
                          "checkInPolicy",
                          "checkOutPolicy",
                          "roomAssignmentMode"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "type",
                      "schemaVersion",
                      "config"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "transport"
                        ]
                      },
                      "schemaVersion": {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      "config": {
                        "type": "object",
                        "properties": {
                          "meetingPlaceId": {
                            "type": [
                              "string",
                              "null"
                            ],
                            "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                          },
                          "participantMode": {
                            "type": "string",
                            "enum": [
                              "self_arranged",
                              "shared",
                              "mixed"
                            ]
                          }
                        },
                        "required": [
                          "meetingPlaceId",
                          "participantMode"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "type",
                      "schemaVersion",
                      "config"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "golf"
                        ]
                      },
                      "schemaVersion": {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      "config": {
                        "type": "object",
                        "properties": {
                          "coursePlaceId": {
                            "type": [
                              "string",
                              "null"
                            ],
                            "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                          },
                          "teeFormat": {
                            "type": "string",
                            "enum": [
                              "individual",
                              "pairs",
                              "fourball"
                            ]
                          },
                          "handicapMode": {
                            "type": "string",
                            "enum": [
                              "none",
                              "optional",
                              "required"
                            ]
                          },
                          "scoringMode": {
                            "type": "string",
                            "enum": [
                              "none",
                              "stroke_play",
                              "stableford"
                            ]
                          },
                          "roundState": {
                            "type": "string",
                            "enum": [
                              "planned",
                              "open",
                              "closed"
                            ]
                          }
                        },
                        "required": [
                          "coursePlaceId",
                          "teeFormat",
                          "handicapMode",
                          "scoringMode",
                          "roundState"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "type",
                      "schemaVersion",
                      "config"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "team"
                        ]
                      },
                      "schemaVersion": {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      "config": {
                        "type": "object",
                        "properties": {
                          "venuePlaceId": {
                            "type": [
                              "string",
                              "null"
                            ],
                            "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                          },
                          "assignmentMode": {
                            "type": "string",
                            "enum": [
                              "organizer",
                              "self_select",
                              "random"
                            ]
                          },
                          "capacityPerTeam": {
                            "type": [
                              "integer",
                              "null"
                            ],
                            "minimum": 1,
                            "maximum": 1000
                          },
                          "facilitator": {
                            "type": [
                              "string",
                              "null"
                            ],
                            "minLength": 1,
                            "maxLength": 160
                          }
                        },
                        "required": [
                          "venuePlaceId",
                          "assignmentMode",
                          "capacityPerTeam",
                          "facilitator"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "type",
                      "schemaVersion",
                      "config"
                    ],
                    "additionalProperties": false
                  }
                ]
              }
            }
          },
          "required": [
            "logicalKey",
            "parentLogicalKey",
            "kind",
            "title",
            "capabilities"
          ],
          "additionalProperties": false
        }
      }
    },
    "required": [
      "id",
      "version",
      "title",
      "summary",
      "events"
    ],
    "additionalProperties": false
  },
  "EventServiceEventTemplateAdoptionResponse": {
    "type": "object",
    "properties": {
      "event": {
        "$ref": "#/components/schemas/EventServiceEvent"
      },
      "rootRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "template": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "enum": [
              "travel",
              "golf-tour",
              "team-event"
            ]
          },
          "version": {
            "type": "number",
            "enum": [
              1
            ]
          }
        },
        "required": [
          "id",
          "version"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "event",
      "rootRevision",
      "template"
    ],
    "additionalProperties": false
  },
  "EventServiceFeedback": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "body": {
        "type": "string",
        "minLength": 1,
        "maxLength": 10000
      },
      "visibility": {
        "type": "string",
        "enum": [
          "public",
          "private"
        ]
      },
      "context": {
        "$ref": "#/components/schemas/EventServiceFeedbackContext"
      },
      "diagnostics": {
        "$ref": "#/components/schemas/EventServiceFeedbackDiagnostics"
      },
      "authorUserId": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^usr_[a-f0-9]{32}$"
          },
          {
            "type": "null"
          },
          {
            "type": "null"
          }
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined",
          "duplicate"
        ]
      },
      "duplicateOfFeedbackId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 1000
      },
      "voteCount": {
        "type": "integer",
        "minimum": 0
      },
      "viewerHasVoted": {
        "type": "boolean"
      },
      "attachments": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceFeedbackAttachment"
        },
        "maxItems": 5
      },
      "comments": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceFeedbackComment"
        },
        "maxItems": 20
      },
      "commentCount": {
        "type": "integer",
        "minimum": 0
      },
      "commentsHasMore": {
        "type": "boolean"
      },
      "statusHistory": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceFeedbackStatusChange"
        },
        "maxItems": 20
      },
      "statusHistoryCount": {
        "type": "integer",
        "minimum": 0
      },
      "statusHistoryHasMore": {
        "type": "boolean"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "title",
      "body",
      "visibility",
      "context",
      "diagnostics",
      "authorUserId",
      "status",
      "duplicateOfFeedbackId",
      "version",
      "voteCount",
      "viewerHasVoted",
      "attachments",
      "comments",
      "commentCount",
      "commentsHasMore",
      "statusHistory",
      "statusHistoryCount",
      "statusHistoryHasMore",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceFeedbackAttachment": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
      },
      "contentType": {
        "type": "string",
        "enum": [
          "image/jpeg",
          "image/png",
          "image/webp"
        ]
      },
      "byteCount": {
        "type": "integer",
        "minimum": 1,
        "maximum": 20971520
      },
      "sha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "caption": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 1000
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "contentType",
      "byteCount",
      "sha256",
      "caption",
      "createdAt"
    ],
    "additionalProperties": false
  },
  "EventServiceFeedbackComment": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^fbc_[A-Za-z0-9._:-]{1,96}$"
      },
      "authorUserId": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^usr_[a-f0-9]{32}$"
          },
          {
            "type": "null"
          },
          {
            "type": "null"
          }
        ]
      },
      "body": {
        "type": "string",
        "minLength": 1,
        "maxLength": 5000
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "authorUserId",
      "body",
      "createdAt"
    ],
    "additionalProperties": false
  },
  "EventServiceFeedbackContext": {
    "type": [
      "object",
      "null"
    ],
    "properties": {
      "rootEventId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "screenKey": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$"
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "screenKey"
    ],
    "additionalProperties": false
  },
  "EventServiceFeedbackDiagnostics": {
    "type": [
      "object",
      "null"
    ],
    "properties": {
      "appVersion": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64
      },
      "buildNumber": {
        "type": "string",
        "minLength": 1,
        "maxLength": 32
      },
      "platform": {
        "type": "string",
        "enum": [
          "ios",
          "android"
        ]
      },
      "osVersion": {
        "type": "string",
        "minLength": 1,
        "maxLength": 64
      },
      "deviceModel": {
        "type": "string",
        "minLength": 1,
        "maxLength": 120
      },
      "locale": {
        "type": "string",
        "minLength": 2,
        "maxLength": 35
      }
    },
    "additionalProperties": false
  },
  "EventServiceFeedbackStatusChange": {
    "type": "object",
    "properties": {
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 1000
      },
      "fromStatus": {
        "anyOf": [
          {
            "type": "string",
            "enum": [
              "open",
              "planned",
              "in_progress",
              "completed",
              "declined",
              "duplicate"
            ]
          },
          {
            "type": "null"
          },
          {
            "type": "null"
          }
        ]
      },
      "toStatus": {
        "type": "string",
        "enum": [
          "open",
          "planned",
          "in_progress",
          "completed",
          "declined",
          "duplicate"
        ]
      },
      "changedBy": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^usr_[a-f0-9]{32}$"
          },
          {
            "type": "null"
          },
          {
            "type": "null"
          }
        ]
      },
      "note": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 1000
      },
      "changedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "version",
      "fromStatus",
      "toStatus",
      "changedBy",
      "note",
      "changedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceItineraryItem": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^iti_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string"
      },
      "notes": {
        "type": [
          "string",
          "null"
        ]
      },
      "timeZone": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "startsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "endsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "allDay": {
        "type": "boolean"
      },
      "sortKey": {
        "type": "string",
        "pattern": "^[1-9]\\d*$"
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "cancelled",
          "archived"
        ]
      },
      "details": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "note"
                ]
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "activity"
                ]
              },
              "bookingReference": {
                "type": "string",
                "maxLength": 300
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "flight"
                ]
              },
              "originPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "destinationPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "flightDesignator": {
                "type": "string",
                "maxLength": 20
              },
              "originPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              },
              "destinationPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "originPlaceId",
              "destinationPlaceId",
              "originPlaceSnapshot",
              "destinationPlaceSnapshot"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "rail"
                ]
              },
              "originPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "destinationPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "serviceDesignator": {
                "type": "string",
                "maxLength": 50
              },
              "originPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              },
              "destinationPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "originPlaceId",
              "destinationPlaceId",
              "originPlaceSnapshot",
              "destinationPlaceSnapshot"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "road_transfer"
                ]
              },
              "originPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "destinationPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "pickupInstructions": {
                "type": "string",
                "maxLength": 1000
              },
              "originPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              },
              "destinationPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "originPlaceId",
              "destinationPlaceId",
              "originPlaceSnapshot",
              "destinationPlaceSnapshot"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "lodging"
                ]
              },
              "propertyName": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              "checkInAt": {
                "type": "string",
                "format": "date-time"
              },
              "checkOutAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "propertyName",
              "checkInAt",
              "checkOutAt"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "meal"
                ]
              },
              "reservationNote": {
                "type": "string",
                "maxLength": 1000
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "golf_round"
                ]
              },
              "roundReference": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "teeTime": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "roundReference",
              "teeTime"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "session"
                ]
              },
              "room": {
                "type": "string",
                "maxLength": 120
              },
              "descendantEventId": {
                "type": "string",
                "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          }
        ]
      },
      "placeId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
      },
      "placeSnapshot": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
          },
          "name": {
            "type": "string"
          },
          "locality": {
            "type": [
              "string",
              "null"
            ]
          },
          "countryCode": {
            "type": "string"
          },
          "latitude": {
            "type": [
              "number",
              "null"
            ]
          },
          "longitude": {
            "type": [
              "number",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "name",
          "locality",
          "countryCode",
          "latitude",
          "longitude"
        ],
        "additionalProperties": false
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "eventId",
      "title",
      "notes",
      "timeZone",
      "startsAt",
      "endsAt",
      "allDay",
      "sortKey",
      "status",
      "details",
      "placeId",
      "placeSnapshot",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServicePlaceEnrichment": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^pej_[a-f0-9]{64}$"
      },
      "status": {
        "type": "string",
        "enum": [
          "pending",
          "processing",
          "retry",
          "succeeded",
          "failed",
          "dead"
        ]
      },
      "pollAfterSeconds": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": 1,
        "maximum": 30
      },
      "retryAllowed": {
        "type": "boolean"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "completedAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "status",
      "pollAfterSeconds",
      "retryAllowed",
      "createdAt",
      "updatedAt",
      "completedAt"
    ],
    "additionalProperties": false
  },
  "EventServicePlaceSearchResult": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "kind": {
        "type": "string",
        "enum": [
          "golf_course",
          "venue"
        ]
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 300
      },
      "locality": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 200
      },
      "region": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 200
      },
      "countryCode": {
        "type": "string",
        "pattern": "^[A-Z]{2}$"
      },
      "latitude": {
        "type": [
          "number",
          "null"
        ],
        "minimum": -90,
        "maximum": 90
      },
      "longitude": {
        "type": [
          "number",
          "null"
        ],
        "minimum": -180,
        "maximum": 180
      },
      "status": {
        "type": "string",
        "enum": [
          "pending",
          "enriched"
        ]
      },
      "source": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9._-]{0,63}$"
      },
      "sourceRecordUrl": {
        "type": [
          "string",
          "null"
        ],
        "maxLength": 2048,
        "format": "uri"
      },
      "licenseCode": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "licenseUrl": {
        "type": [
          "string",
          "null"
        ],
        "maxLength": 2048,
        "format": "uri"
      },
      "attribution": {
        "type": "string",
        "minLength": 1,
        "maxLength": 500
      },
      "retrievedAt": {
        "type": "string",
        "format": "date-time"
      },
      "confidence": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      }
    },
    "required": [
      "id",
      "kind",
      "name",
      "locality",
      "region",
      "countryCode",
      "latitude",
      "longitude",
      "status",
      "source",
      "sourceRecordUrl",
      "licenseCode",
      "licenseUrl",
      "attribution",
      "retrievedAt",
      "confidence",
      "version"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncAttachmentData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "target": {
        "type": "object",
        "properties": {
          "entityType": {
            "type": "string",
            "enum": [
              "feedEntry"
            ]
          },
          "entityId": {
            "type": "string",
            "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
          }
        },
        "required": [
          "entityType",
          "entityId"
        ],
        "additionalProperties": false
      },
      "contentType": {
        "type": "string",
        "enum": [
          "image/jpeg",
          "image/png",
          "image/webp"
        ]
      },
      "byteCount": {
        "type": "integer",
        "minimum": 1,
        "maximum": 20971520
      },
      "sha256": {
        "type": "string",
        "pattern": "^[a-f0-9]{64}$"
      },
      "caption": {
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 1000
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "target",
      "contentType",
      "byteCount",
      "sha256",
      "caption",
      "version",
      "createdAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncBootstrapResponse": {
    "type": "object",
    "properties": {
      "protocolVersion": {
        "type": "number",
        "enum": [
          1
        ]
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "authorizationScopeVersion": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "snapshotId": {
        "type": "string",
        "pattern": "^snp_[A-Za-z0-9._:-]{1,96}$"
      },
      "snapshotRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "records": {
        "type": "array",
        "items": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "event"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncEventData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "membership"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^usr_[a-f0-9]{32}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncMembershipData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "invitation"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^inv_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncInvitationData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "place"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncPlaceData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "capability"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}:(travel|lodging|transport|golf|team)$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncCapabilityData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "itineraryItem"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^iti_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncItineraryData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "feedEntry"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncFeedEntryData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "feedReaction"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^fer_[a-f0-9]{64}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncFeedReactionData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "attachment"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncAttachmentData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "golfRound"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncGolfRoundData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "golfRoster"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^gro_evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncGolfRosterData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "golfPlayer"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^gpl_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncGolfPlayerData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "golfScore"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^gsc_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}:(?:[1-9]|1[0-8])$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncGolfScoreData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "golfLeaderboard"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^glb_evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncGolfLeaderboardData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "teamAssignmentSet"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncTeamAssignmentSetData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "teamAssignmentRoster"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^tro_evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncTeamAssignmentRosterData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "teamAssignment"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^tma_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncTeamAssignmentData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "teamDecision"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^tdc_[A-Za-z0-9._:-]{1,96}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncTeamDecisionData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "entityType": {
                  "type": "string",
                  "enum": [
                    "teamResponse"
                  ]
                },
                "entityId": {
                  "type": "string",
                  "pattern": "^trp_tdc_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                },
                "entityVersion": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                },
                "data": {
                  "$ref": "#/components/schemas/EventServiceSyncTeamResponseData"
                }
              },
              "required": [
                "entityType",
                "entityId",
                "entityVersion",
                "data"
              ],
              "additionalProperties": false
            }
          ]
        }
      },
      "syncCursor": {
        "type": "string",
        "minLength": 16,
        "maxLength": 4096
      },
      "pageInfo": {
        "type": "object",
        "properties": {
          "nextCursor": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 16,
            "maxLength": 4096
          },
          "hasMore": {
            "type": "boolean"
          }
        },
        "required": [
          "nextCursor",
          "hasMore"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "protocolVersion",
      "rootEventId",
      "authorizationScopeVersion",
      "snapshotId",
      "snapshotRevision",
      "records",
      "syncCursor",
      "pageInfo"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncCapabilityData": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "travel"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "homePlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "travelerReferenceLabel": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 120
              }
            },
            "required": [
              "homePlaceId",
              "travelerReferenceLabel"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "deletedAt": {
            "type": "null"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt",
          "deletedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "lodging"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "propertyPlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "checkInPolicy": {
                "type": "string",
                "enum": [
                  "fixed",
                  "flexible"
                ]
              },
              "checkOutPolicy": {
                "type": "string",
                "enum": [
                  "fixed",
                  "flexible"
                ]
              },
              "roomAssignmentMode": {
                "type": "string",
                "enum": [
                  "organizer",
                  "self_service"
                ]
              }
            },
            "required": [
              "propertyPlaceId",
              "checkInPolicy",
              "checkOutPolicy",
              "roomAssignmentMode"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "deletedAt": {
            "type": "null"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt",
          "deletedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "transport"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "meetingPlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "participantMode": {
                "type": "string",
                "enum": [
                  "self_arranged",
                  "shared",
                  "mixed"
                ]
              }
            },
            "required": [
              "meetingPlaceId",
              "participantMode"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "deletedAt": {
            "type": "null"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt",
          "deletedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "golf"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "coursePlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "teeFormat": {
                "type": "string",
                "enum": [
                  "individual",
                  "pairs",
                  "fourball"
                ]
              },
              "handicapMode": {
                "type": "string",
                "enum": [
                  "none",
                  "optional",
                  "required"
                ]
              },
              "scoringMode": {
                "type": "string",
                "enum": [
                  "none",
                  "stroke_play",
                  "stableford"
                ]
              },
              "roundState": {
                "type": "string",
                "enum": [
                  "planned",
                  "open",
                  "closed"
                ]
              }
            },
            "required": [
              "coursePlaceId",
              "teeFormat",
              "handicapMode",
              "scoringMode",
              "roundState"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "deletedAt": {
            "type": "null"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt",
          "deletedAt"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "team"
            ]
          },
          "schemaVersion": {
            "type": "number",
            "enum": [
              1
            ]
          },
          "config": {
            "type": "object",
            "properties": {
              "venuePlaceId": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "assignmentMode": {
                "type": "string",
                "enum": [
                  "organizer",
                  "self_select",
                  "random"
                ]
              },
              "capacityPerTeam": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 1,
                "maximum": 1000
              },
              "facilitator": {
                "type": [
                  "string",
                  "null"
                ],
                "minLength": 1,
                "maxLength": 160
              }
            },
            "required": [
              "venuePlaceId",
              "assignmentMode",
              "capacityPerTeam",
              "facilitator"
            ],
            "additionalProperties": false
          },
          "rootEventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "eventId": {
            "type": "string",
            "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
          },
          "version": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "createdAt": {
            "type": "string",
            "format": "date-time"
          },
          "updatedAt": {
            "type": "string",
            "format": "date-time"
          },
          "deletedAt": {
            "type": "null"
          }
        },
        "required": [
          "type",
          "schemaVersion",
          "config",
          "rootEventId",
          "eventId",
          "version",
          "createdAt",
          "updatedAt",
          "deletedAt"
        ],
        "additionalProperties": false
      }
    ]
  },
  "EventServiceSyncEventData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "parentEventId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "kind": {
        "type": "string",
        "enum": [
          "trip",
          "day",
          "golf",
          "team_event",
          "session",
          "activity",
          "other"
        ]
      },
      "title": {
        "type": "string"
      },
      "description": {
        "type": [
          "string",
          "null"
        ]
      },
      "timeZone": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "startsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "endsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "sortKey": {
        "type": "string",
        "pattern": "^[1-9]\\d*$"
      },
      "childOrderVersion": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "itineraryOrderVersion": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "published",
          "cancelled",
          "archived"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "deletedAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "parentEventId",
      "kind",
      "title",
      "description",
      "timeZone",
      "startsAt",
      "endsAt",
      "sortKey",
      "childOrderVersion",
      "itineraryOrderVersion",
      "status",
      "version",
      "createdAt",
      "updatedAt",
      "deletedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncFeedEntryData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "parentEntryId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
      },
      "actorUserId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "kind": {
        "type": "string",
        "enum": [
          "message",
          "comment",
          "system"
        ]
      },
      "payloadSchemaVersion": {
        "type": "number",
        "enum": [
          1
        ]
      },
      "payload": {
        "type": "object",
        "properties": {
          "text": {
            "type": [
              "string",
              "null"
            ]
          }
        },
        "required": [
          "text"
        ],
        "additionalProperties": false
      },
      "rootRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "createdRootRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "deletedAt": {
        "type": "null"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "eventId",
      "parentEntryId",
      "actorUserId",
      "kind",
      "payloadSchemaVersion",
      "payload",
      "rootRevision",
      "createdRootRevision",
      "version",
      "createdAt",
      "updatedAt",
      "deletedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncFeedReactionData": {
    "type": "object",
    "properties": {
      "entryId": {
        "type": "string",
        "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "reaction": {
        "type": "string",
        "enum": [
          "like",
          "love",
          "celebrate",
          "laugh",
          "surprised",
          "sad"
        ]
      },
      "present": {
        "type": "boolean",
        "enum": [
          true
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "entryId",
      "rootEventId",
      "userId",
      "reaction",
      "present",
      "version",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfHoleData": {
    "type": "object",
    "properties": {
      "hole": {
        "type": "integer",
        "minimum": 1,
        "maximum": 18
      },
      "par": {
        "type": "integer",
        "minimum": 3,
        "maximum": 6
      },
      "strokeIndex": {
        "type": "integer",
        "minimum": 1,
        "maximum": 18
      }
    },
    "required": [
      "hole",
      "par",
      "strokeIndex"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfLeaderboardData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "entries": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceSyncGolfLeaderboardEntryData"
        },
        "maxItems": 500
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "version",
      "entries"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfLeaderboardEntryData": {
    "type": "object",
    "properties": {
      "rank": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "teamId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^gtm_[A-Za-z0-9._:-]{1,96}$"
      },
      "stablefordPoints": {
        "type": "integer",
        "minimum": 0,
        "maximum": 108
      },
      "holesCompleted": {
        "type": "integer",
        "minimum": 0,
        "maximum": 18
      }
    },
    "required": [
      "rank",
      "userId",
      "teamId",
      "stablefordPoints",
      "holesCompleted"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfPlayerData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "playingHandicap": {
        "type": "integer",
        "minimum": -99,
        "maximum": 99
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "userId",
      "playingHandicap",
      "version"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfRosterData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "players": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "userId": {
              "type": "string",
              "pattern": "^usr_[a-f0-9]{32}$"
            },
            "playingHandicap": {
              "type": "integer",
              "minimum": -99,
              "maximum": 99
            }
          },
          "required": [
            "userId",
            "playingHandicap"
          ],
          "additionalProperties": false
        },
        "minItems": 1,
        "maxItems": 500
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "players",
      "version",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfRoundData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "holes": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceSyncGolfHoleData"
        }
      },
      "teams": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceSyncGolfTeamData"
        },
        "maxItems": 50
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "holes",
      "teams",
      "version",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfScoreData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^gsc_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}:(?:[1-9]|1[0-8])$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "hole": {
        "type": "integer",
        "minimum": 1,
        "maximum": 18
      },
      "strokes": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": 1,
        "maximum": 99
      },
      "putts": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": 0,
        "maximum": 99
      },
      "playingHandicap": {
        "type": "integer",
        "minimum": -99,
        "maximum": 99
      },
      "handicapStrokes": {
        "type": "integer",
        "minimum": -6,
        "maximum": 6
      },
      "netStrokes": {
        "type": [
          "integer",
          "null"
        ],
        "minimum": -5,
        "maximum": 105
      },
      "stablefordPoints": {
        "type": "integer",
        "minimum": 0,
        "maximum": 6
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "rootRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "eventId",
      "userId",
      "hole",
      "strokes",
      "putts",
      "playingHandicap",
      "handicapStrokes",
      "netStrokes",
      "stablefordPoints",
      "version",
      "rootRevision",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncGolfTeamData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^gtm_[A-Za-z0-9._:-]{1,96}$"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "color": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^#[0-9A-F]{6}$"
      },
      "memberUserIds": {
        "type": "array",
        "items": {
          "type": "string",
          "pattern": "^usr_[a-f0-9]{32}$"
        },
        "minItems": 1,
        "maxItems": 4
      }
    },
    "required": [
      "id",
      "name",
      "color",
      "memberUserIds"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncInvitationData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^inv_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "role": {
        "type": "string",
        "enum": [
          "organizer",
          "participant",
          "viewer"
        ]
      },
      "emailBound": {
        "type": "boolean"
      },
      "expiresAt": {
        "type": "string",
        "format": "date-time"
      },
      "maxUses": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "useCount": {
        "type": "integer",
        "minimum": 0,
        "maximum": 9007199254740991
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "revoked"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "role",
      "emailBound",
      "expiresAt",
      "maxUses",
      "useCount",
      "status",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncItineraryData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^iti_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string"
      },
      "notes": {
        "type": [
          "string",
          "null"
        ]
      },
      "timeZone": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "startsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "endsAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      },
      "allDay": {
        "type": "boolean"
      },
      "sortKey": {
        "type": "string",
        "pattern": "^[1-9]\\d*$"
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "cancelled",
          "archived"
        ]
      },
      "details": {
        "oneOf": [
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "note"
                ]
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "activity"
                ]
              },
              "bookingReference": {
                "type": "string",
                "maxLength": 300
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "flight"
                ]
              },
              "originPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "destinationPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "flightDesignator": {
                "type": "string",
                "maxLength": 20
              },
              "originPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              },
              "destinationPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "originPlaceId",
              "destinationPlaceId",
              "originPlaceSnapshot",
              "destinationPlaceSnapshot"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "rail"
                ]
              },
              "originPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "destinationPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "serviceDesignator": {
                "type": "string",
                "maxLength": 50
              },
              "originPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              },
              "destinationPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "originPlaceId",
              "destinationPlaceId",
              "originPlaceSnapshot",
              "destinationPlaceSnapshot"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "road_transfer"
                ]
              },
              "originPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "destinationPlaceId": {
                "type": "string",
                "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
              },
              "pickupInstructions": {
                "type": "string",
                "maxLength": 1000
              },
              "originPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              },
              "destinationPlaceSnapshot": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "name": {
                    "type": "string"
                  },
                  "locality": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "countryCode": {
                    "type": "string"
                  },
                  "latitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  },
                  "longitude": {
                    "type": [
                      "number",
                      "null"
                    ]
                  }
                },
                "required": [
                  "id",
                  "name",
                  "locality",
                  "countryCode",
                  "latitude",
                  "longitude"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "originPlaceId",
              "destinationPlaceId",
              "originPlaceSnapshot",
              "destinationPlaceSnapshot"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "lodging"
                ]
              },
              "propertyName": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              "checkInAt": {
                "type": "string",
                "format": "date-time"
              },
              "checkOutAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "propertyName",
              "checkInAt",
              "checkOutAt"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "meal"
                ]
              },
              "reservationNote": {
                "type": "string",
                "maxLength": 1000
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "golf_round"
                ]
              },
              "roundReference": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "teeTime": {
                "type": "string",
                "format": "date-time"
              }
            },
            "required": [
              "schemaVersion",
              "type",
              "roundReference",
              "teeTime"
            ],
            "additionalProperties": false
          },
          {
            "type": "object",
            "properties": {
              "schemaVersion": {
                "type": "number",
                "enum": [
                  1
                ]
              },
              "type": {
                "type": "string",
                "enum": [
                  "session"
                ]
              },
              "room": {
                "type": "string",
                "maxLength": 120
              },
              "descendantEventId": {
                "type": "string",
                "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
              }
            },
            "required": [
              "schemaVersion",
              "type"
            ],
            "additionalProperties": false
          }
        ]
      },
      "placeId": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
      },
      "placeSnapshot": {
        "type": [
          "object",
          "null"
        ],
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
          },
          "name": {
            "type": "string"
          },
          "locality": {
            "type": [
              "string",
              "null"
            ]
          },
          "countryCode": {
            "type": "string"
          },
          "latitude": {
            "type": [
              "number",
              "null"
            ]
          },
          "longitude": {
            "type": [
              "number",
              "null"
            ]
          }
        },
        "required": [
          "id",
          "name",
          "locality",
          "countryCode",
          "latitude",
          "longitude"
        ],
        "additionalProperties": false
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "deletedAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "eventId",
      "title",
      "notes",
      "timeZone",
      "startsAt",
      "endsAt",
      "allDay",
      "sortKey",
      "status",
      "details",
      "placeId",
      "placeSnapshot",
      "version",
      "createdAt",
      "updatedAt",
      "deletedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncMembershipData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "role": {
        "type": "string",
        "enum": [
          "owner",
          "organizer",
          "participant",
          "viewer"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "left",
          "removed"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "rootEventId",
      "userId",
      "role",
      "status",
      "version",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncPlaceData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "name": {
        "type": "string"
      },
      "locality": {
        "type": [
          "string",
          "null"
        ]
      },
      "countryCode": {
        "type": "string",
        "minLength": 2,
        "maxLength": 2
      },
      "latitude": {
        "type": [
          "number",
          "null"
        ]
      },
      "longitude": {
        "type": [
          "number",
          "null"
        ]
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "deletedAt": {
        "type": [
          "string",
          "null"
        ],
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "name",
      "locality",
      "countryCode",
      "latitude",
      "longitude",
      "version",
      "createdAt",
      "updatedAt",
      "deletedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncPullResponse": {
    "type": "object",
    "properties": {
      "protocolVersion": {
        "type": "number",
        "enum": [
          1
        ]
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "authorizationScopeVersion": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "changes": {
        "type": "array",
        "items": {
          "anyOf": [
            {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "event"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncEventData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "membership"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^usr_[a-f0-9]{32}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncMembershipData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "invitation"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^inv_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncInvitationData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "place"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^plc_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncPlaceData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "capability"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^evt_[A-Za-z0-9._:-]{1,96}:(travel|lodging|transport|golf|team)$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncCapabilityData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "itineraryItem"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^iti_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncItineraryData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "feedEntry"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncFeedEntryData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "feedReaction"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^fer_[a-f0-9]{64}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncFeedReactionData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "attachment"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncAttachmentData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "golfRound"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncGolfRoundData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "golfRoster"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^gro_evt_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncGolfRosterData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "golfPlayer"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^gpl_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncGolfPlayerData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "golfScore"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^gsc_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}:(?:[1-9]|1[0-8])$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncGolfScoreData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "golfLeaderboard"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^glb_evt_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncGolfLeaderboardData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "teamAssignmentSet"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncTeamAssignmentSetData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "teamAssignmentRoster"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^tro_evt_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncTeamAssignmentRosterData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "teamAssignment"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^tma_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncTeamAssignmentData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "teamDecision"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^tdc_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncTeamDecisionData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "teamResponse"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^trp_tdc_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "upsert"
                      ]
                    },
                    "data": {
                      "$ref": "#/components/schemas/EventServiceSyncTeamResponseData"
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "data"
                  ],
                  "additionalProperties": false
                }
              ]
            },
            {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "event"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "entityType": {
                          "type": "string",
                          "enum": [
                            "event"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "eventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "entityType",
                        "id",
                        "rootEventId",
                        "eventId",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "teamAssignment"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^tma_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "entityType": {
                          "type": "string",
                          "enum": [
                            "teamAssignment"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^tma_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "eventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "entityType",
                        "id",
                        "rootEventId",
                        "eventId",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "invitation"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^inv_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "entityType": {
                          "type": "string",
                          "enum": [
                            "invitation"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^inv_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "eventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "entityType",
                        "id",
                        "rootEventId",
                        "eventId",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "itineraryItem"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^iti_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "entityType": {
                          "type": "string",
                          "enum": [
                            "itineraryItem"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^iti_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "eventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "entityType",
                        "id",
                        "rootEventId",
                        "eventId",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "golfPlayer"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^gpl_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "entityType": {
                          "type": "string",
                          "enum": [
                            "golfPlayer"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^gpl_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "eventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "entityType",
                        "id",
                        "rootEventId",
                        "eventId",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "capability"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^evt_[A-Za-z0-9._:-]{1,96}:(travel|lodging|transport|golf|team)$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "entityType": {
                          "type": "string",
                          "enum": [
                            "capability"
                          ]
                        },
                        "id": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}:(travel|lodging|transport|golf|team)$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "eventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "type": {
                          "type": "string",
                          "enum": [
                            "travel",
                            "lodging",
                            "transport",
                            "golf",
                            "team"
                          ]
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "entityType",
                        "id",
                        "rootEventId",
                        "eventId",
                        "type",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "feedEntry"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "eventId": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "id",
                        "rootEventId",
                        "eventId",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "rootRevision": {
                      "type": "string",
                      "pattern": "^(0|[1-9]\\d*)$"
                    },
                    "ordinal": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityVersion": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    },
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "feedReaction"
                      ]
                    },
                    "entityId": {
                      "type": "string",
                      "pattern": "^fer_[a-f0-9]{64}$"
                    },
                    "operation": {
                      "type": "string",
                      "enum": [
                        "tombstone"
                      ]
                    },
                    "tombstone": {
                      "type": "object",
                      "properties": {
                        "entryId": {
                          "type": "string",
                          "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "userId": {
                          "type": "string",
                          "pattern": "^usr_[a-f0-9]{32}$"
                        },
                        "reaction": {
                          "type": "string",
                          "enum": [
                            "like",
                            "love",
                            "celebrate",
                            "laugh",
                            "surprised",
                            "sad"
                          ]
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0,
                          "maximum": 9007199254740991
                        },
                        "deletedAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "entryId",
                        "rootEventId",
                        "userId",
                        "reaction",
                        "version",
                        "deletedAt"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "rootRevision",
                    "ordinal",
                    "entityVersion",
                    "entityType",
                    "entityId",
                    "operation",
                    "tombstone"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          ]
        }
      },
      "checkpointCursor": {
        "type": "string",
        "minLength": 16,
        "maxLength": 4096
      },
      "pageInfo": {
        "type": "object",
        "properties": {
          "nextCursor": {
            "type": [
              "string",
              "null"
            ],
            "minLength": 16,
            "maxLength": 4096
          },
          "hasMore": {
            "type": "boolean"
          }
        },
        "required": [
          "nextCursor",
          "hasMore"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "protocolVersion",
      "rootEventId",
      "authorizationScopeVersion",
      "changes",
      "checkpointCursor",
      "pageInfo"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncPushResponse": {
    "type": "object",
    "properties": {
      "protocolVersion": {
        "type": "number",
        "enum": [
          1
        ]
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "deviceId": {
        "type": "string",
        "pattern": "^dvc_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
      },
      "results": {
        "type": "array",
        "items": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "clientMutationId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                },
                "clientSequence": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740990
                },
                "outcome": {
                  "type": "string",
                  "enum": [
                    "applied"
                  ]
                },
                "replayed": {
                  "type": "boolean"
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^(0|[1-9]\\d*)$"
                },
                "entity": {
                  "type": "object",
                  "properties": {
                    "entityType": {
                      "type": "string",
                      "enum": [
                        "event",
                        "membership",
                        "invitation",
                        "place",
                        "capability",
                        "itineraryItem",
                        "feedEntry",
                        "feedReaction",
                        "attachment",
                        "golfRound",
                        "golfRoster",
                        "golfPlayer",
                        "golfScore",
                        "golfLeaderboard",
                        "teamAssignmentSet",
                        "teamAssignmentRoster",
                        "teamAssignment",
                        "teamDecision",
                        "teamResponse"
                      ]
                    },
                    "entityId": {
                      "type": "string"
                    },
                    "version": {
                      "type": "integer",
                      "exclusiveMinimum": 0,
                      "maximum": 9007199254740991
                    }
                  },
                  "required": [
                    "entityType",
                    "entityId",
                    "version"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "clientMutationId",
                "clientSequence",
                "outcome",
                "replayed",
                "rootRevision"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "clientMutationId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                },
                "clientSequence": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740990
                },
                "outcome": {
                  "type": "string",
                  "enum": [
                    "rejected"
                  ]
                },
                "replayed": {
                  "type": "boolean"
                },
                "error": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "currentVersion": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "authoritativeOrder": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "retryable": {
                      "type": "boolean",
                      "enum": [
                        false
                      ]
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "retryable"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "clientMutationId",
                "clientSequence",
                "outcome",
                "replayed",
                "error"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "clientMutationId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                },
                "clientSequence": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740990
                },
                "outcome": {
                  "type": "string",
                  "enum": [
                    "retry"
                  ]
                },
                "replayed": {
                  "type": "boolean",
                  "enum": [
                    false
                  ]
                },
                "error": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "currentVersion": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "authoritativeOrder": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "retryable": {
                      "type": "boolean",
                      "enum": [
                        true
                      ]
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "retryable"
                  ],
                  "additionalProperties": false
                },
                "retryAfterSeconds": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "clientMutationId",
                "clientSequence",
                "outcome",
                "replayed",
                "error",
                "retryAfterSeconds"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "clientMutationId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
                },
                "clientSequence": {
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740990
                },
                "outcome": {
                  "type": "string",
                  "enum": [
                    "blocked"
                  ]
                },
                "replayed": {
                  "type": "boolean",
                  "enum": [
                    false
                  ]
                },
                "error": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "string"
                    },
                    "message": {
                      "type": "string"
                    },
                    "currentVersion": {
                      "type": "integer",
                      "minimum": 0,
                      "maximum": 9007199254740991
                    },
                    "authoritativeOrder": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    },
                    "retryable": {
                      "type": "boolean",
                      "enum": [
                        false
                      ]
                    }
                  },
                  "required": [
                    "code",
                    "message",
                    "retryable"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "clientMutationId",
                "clientSequence",
                "outcome",
                "replayed",
                "error"
              ],
              "additionalProperties": false
            }
          ]
        }
      },
      "nextExpectedClientSequence": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      }
    },
    "required": [
      "protocolVersion",
      "rootEventId",
      "deviceId",
      "results",
      "nextExpectedClientSequence"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncTeamAssignmentData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "team": {
        "$ref": "#/components/schemas/EventServiceSyncTeamPublicTeamData"
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "userId",
      "team",
      "version",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncTeamAssignmentRosterData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "teams": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^ttm_[A-Za-z0-9._:-]{1,96}$"
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80
            },
            "color": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^#[0-9A-F]{6}$"
            },
            "memberUserIds": {
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^usr_[a-f0-9]{32}$"
              },
              "minItems": 1,
              "maxItems": 1000
            }
          },
          "required": [
            "id",
            "name",
            "color",
            "memberUserIds"
          ],
          "additionalProperties": false
        },
        "minItems": 1,
        "maxItems": 100
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "teams",
      "version",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncTeamAssignmentSetData": {
    "type": "object",
    "properties": {
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "teams": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceSyncTeamPublicTeamData"
        },
        "minItems": 1,
        "maxItems": 100
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "rootEventId",
      "eventId",
      "teams",
      "version",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncTeamDecisionData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^tdc_[A-Za-z0-9._:-]{1,96}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 240
      },
      "state": {
        "type": "string",
        "enum": [
          "draft",
          "open",
          "closed"
        ]
      },
      "options": {
        "type": "array",
        "items": {
          "$ref": "#/components/schemas/EventServiceSyncTeamDecisionOptionData"
        },
        "minItems": 2,
        "maxItems": 20
      },
      "responseCount": {
        "type": "integer",
        "minimum": 0,
        "maximum": 1000
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "aggregateVersion": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "eventId",
      "title",
      "state",
      "options",
      "responseCount",
      "version",
      "aggregateVersion",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncTeamDecisionOptionData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^tdo_[A-Za-z0-9._:-]{1,96}$"
      },
      "label": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160
      },
      "responseCount": {
        "type": "integer",
        "minimum": 0,
        "maximum": 1000
      }
    },
    "required": [
      "id",
      "label",
      "responseCount"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncTeamPublicTeamData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^ttm_[A-Za-z0-9._:-]{1,96}$"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80
      },
      "color": {
        "type": [
          "string",
          "null"
        ],
        "pattern": "^#[0-9A-F]{6}$"
      }
    },
    "required": [
      "id",
      "name",
      "color"
    ],
    "additionalProperties": false
  },
  "EventServiceSyncTeamResponseData": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^trp_tdc_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$"
      },
      "rootEventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "eventId": {
        "type": "string",
        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
      },
      "decisionId": {
        "type": "string",
        "pattern": "^tdc_[A-Za-z0-9._:-]{1,96}$"
      },
      "userId": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "optionId": {
        "type": "string",
        "pattern": "^tdo_[A-Za-z0-9._:-]{1,96}$"
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0,
        "maximum": 9007199254740991
      },
      "rootRevision": {
        "type": "string",
        "pattern": "^(0|[1-9]\\d*)$"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "rootEventId",
      "eventId",
      "decisionId",
      "userId",
      "optionId",
      "version",
      "rootRevision",
      "createdAt",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "MemberDirectoryPage": {
    "type": "object",
    "properties": {
      "items": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "userId": {
              "type": "string",
              "pattern": "^usr_[a-f0-9]{32}$"
            },
            "displayName": {
              "type": [
                "string",
                "null"
              ]
            }
          },
          "required": [
            "userId",
            "displayName"
          ],
          "additionalProperties": false
        },
        "maxItems": 200
      },
      "pageInfo": {
        "type": "object",
        "properties": {
          "nextCursor": {
            "type": [
              "string",
              "null"
            ]
          },
          "hasMore": {
            "type": "boolean"
          }
        },
        "required": [
          "nextCursor",
          "hasMore"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "items",
      "pageInfo"
    ],
    "additionalProperties": false
  },
  "Session": {
    "type": "object",
    "properties": {
      "actor": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "pattern": "^usr_[a-f0-9]{32}$"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "actor"
    ],
    "additionalProperties": false
  },
  "UserServiceDevice": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^dev_[a-f0-9]{32}$"
      },
      "installationId": {
        "type": "string"
      },
      "platform": {
        "type": "string",
        "enum": [
          "ios",
          "android"
        ]
      },
      "locale": {
        "type": "string"
      },
      "timeZone": {
        "type": "string"
      },
      "appVersion": {
        "type": "string"
      },
      "notificationsEnabled": {
        "type": "boolean"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "installationId",
      "platform",
      "locale",
      "timeZone",
      "appVersion",
      "notificationsEnabled",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "UserServiceProfile": {
    "type": "object",
    "properties": {
      "displayName": {
        "type": [
          "string",
          "null"
        ]
      },
      "avatarUrl": {
        "type": [
          "string",
          "null"
        ],
        "format": "uri"
      },
      "locale": {
        "type": "string"
      },
      "timeZone": {
        "type": "string"
      },
      "reduceMotion": {
        "type": "boolean"
      },
      "eventReminders": {
        "type": "boolean"
      },
      "productUpdates": {
        "type": "boolean"
      },
      "version": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "displayName",
      "avatarUrl",
      "locale",
      "timeZone",
      "reduceMotion",
      "eventReminders",
      "productUpdates",
      "version",
      "updatedAt"
    ],
    "additionalProperties": false
  },
  "UserServiceSession": {
    "type": "object",
    "properties": {
      "accessToken": {
        "type": "string"
      },
      "refreshToken": {
        "type": "string"
      },
      "tokenType": {
        "type": "string",
        "enum": [
          "Bearer"
        ]
      },
      "expiresInSeconds": {
        "type": "integer",
        "exclusiveMinimum": 0
      },
      "user": {
        "$ref": "#/components/schemas/UserServiceUser"
      }
    },
    "required": [
      "accessToken",
      "refreshToken",
      "tokenType",
      "expiresInSeconds",
      "user"
    ],
    "additionalProperties": false
  },
  "UserServiceUser": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^usr_[a-f0-9]{32}$"
      },
      "email": {
        "type": "string",
        "maxLength": 254,
        "format": "email"
      },
      "profile": {
        "$ref": "#/components/schemas/UserServiceProfile"
      }
    },
    "required": [
      "id",
      "email",
      "profile"
    ],
    "additionalProperties": false
  }
};

export const gatewayRoutes: readonly GatewayRoute[] = [
  {
    "operationId": "eventAttachmentsDownload",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/attachments/{attachmentId}/download",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "attachmentId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "attachment": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                },
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "target": {
                  "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                },
                "targetEntryId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "contentType": {
                  "type": "string",
                  "enum": [
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                  ]
                },
                "byteCount": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20971520
                },
                "sha256": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{64}$"
                },
                "caption": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "minLength": 1,
                  "maxLength": 1000
                },
                "integrityStatus": {
                  "type": "string",
                  "enum": [
                    "integrity_verified"
                  ]
                },
                "version": {
                  "type": "integer",
                  "exclusiveMinimum": 0
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "id",
                "rootEventId",
                "target",
                "targetEntryId",
                "contentType",
                "byteCount",
                "sha256",
                "caption",
                "integrityStatus",
                "version",
                "rootRevision",
                "createdAt"
              ],
              "additionalProperties": false
            },
            "download": {
              "type": "object",
              "properties": {
                "method": {
                  "type": "string",
                  "enum": [
                    "GET"
                  ]
                },
                "url": {
                  "type": "string",
                  "format": "uri"
                },
                "headers": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  }
                },
                "expiresAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "method",
                "url",
                "headers",
                "expiresAt"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "attachment",
            "download"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventAttachmentUploadsFinalize",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/attachments/uploads/{uploadId}/finalize",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId",
      "uploadId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "attachment": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                },
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "target": {
                  "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                },
                "targetEntryId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "contentType": {
                  "type": "string",
                  "enum": [
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                  ]
                },
                "byteCount": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20971520
                },
                "sha256": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{64}$"
                },
                "caption": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "minLength": 1,
                  "maxLength": 1000
                },
                "integrityStatus": {
                  "type": "string",
                  "enum": [
                    "integrity_verified"
                  ]
                },
                "version": {
                  "type": "integer",
                  "exclusiveMinimum": 0
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "id",
                "rootEventId",
                "target",
                "targetEntryId",
                "contentType",
                "byteCount",
                "sha256",
                "caption",
                "integrityStatus",
                "version",
                "rootRevision",
                "createdAt"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "attachment"
          ],
          "additionalProperties": false
        }
      },
      {
        "status": 202,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "uploadId": {
              "type": "string",
              "pattern": "^upl_[A-Za-z0-9._:-]{1,96}$"
            },
            "verification": {
              "type": "object",
              "properties": {
                "state": {
                  "type": "string",
                  "enum": [
                    "pending",
                    "processing",
                    "retry"
                  ]
                },
                "retryable": {
                  "type": "boolean",
                  "enum": [
                    true
                  ]
                }
              },
              "required": [
                "state",
                "retryable"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "uploadId",
            "verification"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventAttachmentUploadsPrepare",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/attachments/uploads",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "upload": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^upl_[A-Za-z0-9._:-]{1,96}$"
                },
                "attachmentId": {
                  "type": "string",
                  "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                },
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "target": {
                  "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                },
                "targetEntryId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "contentType": {
                  "type": "string",
                  "enum": [
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                  ]
                },
                "byteCount": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20971520
                },
                "sha256": {
                  "type": "string",
                  "pattern": "^[a-f0-9]{64}$"
                },
                "state": {
                  "type": "string",
                  "enum": [
                    "prepared",
                    "committed",
                    "expired"
                  ]
                },
                "expiresAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "id",
                "attachmentId",
                "rootEventId",
                "target",
                "targetEntryId",
                "contentType",
                "byteCount",
                "sha256",
                "state",
                "expiresAt",
                "createdAt"
              ],
              "additionalProperties": false
            },
            "grant": {
              "type": "object",
              "properties": {
                "method": {
                  "type": "string",
                  "enum": [
                    "POST"
                  ]
                },
                "url": {
                  "type": "string",
                  "format": "uri"
                },
                "fields": {
                  "type": "object",
                  "additionalProperties": {
                    "type": "string"
                  }
                },
                "expiresAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "method",
                "url",
                "fields",
                "expiresAt"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "upload",
            "grant"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventCapabilitiesRemove",
    "method": "DELETE",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}/capabilities/{capabilityType}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "capabilityType",
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [
      "baseVersion"
    ],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "deleted": {
              "type": "boolean",
              "enum": [
                true
              ]
            }
          },
          "required": [
            "deleted"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventCapabilitiesReplace",
    "method": "PUT",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}/capabilities/{capabilityType}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "capabilityType",
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "capability": {
              "$ref": "#/components/schemas/EventServiceEventCapability"
            }
          },
          "required": [
            "capability"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventChildrenCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/events",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventChildrenReorder",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}/children/reorder",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "parent": {
              "$ref": "#/components/schemas/EventServiceEvent"
            },
            "events": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEvent"
              }
            }
          },
          "required": [
            "parent",
            "events"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedbackCommentsCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/feedback/{feedbackId}/comments",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "feedbackId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceCommunityFeedbackDetail"
            },
            "redirectedFromFeedbackId": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
            }
          },
          "required": [
            "feedback",
            "redirectedFromFeedbackId"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedbackDuplicateSuggestionsList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "limit",
      "q"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceCommunityFeedbackDuplicateSuggestion"
              },
              "maxItems": 5
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedbackFollowsSet",
    "method": "PUT",
    "path": "/core/v1/event-roots/{rootEventId}/feedback/{feedbackId}/follow",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "feedbackId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedbackId": {
              "type": "string",
              "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
            },
            "followed": {
              "type": "boolean"
            }
          },
          "required": [
            "feedbackId",
            "followed"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedbackGet",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/feedback/{feedbackId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "feedbackId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceCommunityFeedbackDetail"
            },
            "redirectedFromFeedbackId": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
            }
          },
          "required": [
            "feedback",
            "redirectedFromFeedbackId"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedbackList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/feedback",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "followedOnly",
      "limit",
      "status"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceCommunityFeedbackSummary"
              },
              "maxItems": 10
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedbackUpdatesList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/feedback/updates",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "followedOnly",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceCommunityFeedbackUpdate"
              },
              "maxItems": 50
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedbackVotesSet",
    "method": "PUT",
    "path": "/core/v1/event-roots/{rootEventId}/feedback/{feedbackId}/vote",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "feedbackId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceCommunityFeedbackDetail"
            },
            "redirectedFromFeedbackId": {
              "type": [
                "string",
                "null"
              ],
              "pattern": "^fbk_[A-Za-z0-9._:-]{1,96}$"
            }
          },
          "required": [
            "feedback",
            "redirectedFromFeedbackId"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedEntriesCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/feed",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "entry": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "eventId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "parentEntryId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "authorUserId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^usr_[a-f0-9]{32}$"
                },
                "kind": {
                  "type": "string",
                  "enum": [
                    "message",
                    "comment",
                    "system"
                  ]
                },
                "payloadSchemaVersion": {
                  "type": "number",
                  "enum": [
                    1
                  ]
                },
                "body": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "minLength": 1,
                  "maxLength": 10000
                },
                "version": {
                  "type": "integer",
                  "exclusiveMinimum": 0
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdRootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "updatedAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "deletedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "tombstoneReason": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "author",
                        "moderation"
                      ]
                    },
                    {
                      "type": "null"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "reactions": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "reaction": {
                        "type": "string",
                        "enum": [
                          "like",
                          "love",
                          "celebrate",
                          "laugh",
                          "surprised",
                          "sad"
                        ]
                      },
                      "count": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "viewerPresent": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "reaction",
                      "count",
                      "viewerPresent"
                    ],
                    "additionalProperties": false
                  }
                },
                "attachments": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string",
                        "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "rootEventId": {
                        "type": "string",
                        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "target": {
                        "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                      },
                      "targetEntryId": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "contentType": {
                        "type": "string",
                        "enum": [
                          "image/jpeg",
                          "image/png",
                          "image/webp"
                        ]
                      },
                      "byteCount": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20971520
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      },
                      "caption": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "integrityStatus": {
                        "type": "string",
                        "enum": [
                          "integrity_verified"
                        ]
                      },
                      "version": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "rootRevision": {
                        "type": "string",
                        "pattern": "^[1-9]\\d*$"
                      },
                      "createdAt": {
                        "type": "string",
                        "format": "date-time"
                      }
                    },
                    "required": [
                      "id",
                      "rootEventId",
                      "target",
                      "targetEntryId",
                      "contentType",
                      "byteCount",
                      "sha256",
                      "caption",
                      "integrityStatus",
                      "version",
                      "rootRevision",
                      "createdAt"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "id",
                "rootEventId",
                "eventId",
                "parentEntryId",
                "authorUserId",
                "kind",
                "payloadSchemaVersion",
                "body",
                "version",
                "rootRevision",
                "createdRootRevision",
                "createdAt",
                "updatedAt",
                "deletedAt",
                "tombstoneReason",
                "reactions",
                "attachments"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "entry"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedEntriesGet",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/feed/{entryId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "entryId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "entry": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "eventId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "parentEntryId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "authorUserId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^usr_[a-f0-9]{32}$"
                },
                "kind": {
                  "type": "string",
                  "enum": [
                    "message",
                    "comment",
                    "system"
                  ]
                },
                "payloadSchemaVersion": {
                  "type": "number",
                  "enum": [
                    1
                  ]
                },
                "body": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "minLength": 1,
                  "maxLength": 10000
                },
                "version": {
                  "type": "integer",
                  "exclusiveMinimum": 0
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdRootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "updatedAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "deletedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "tombstoneReason": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "author",
                        "moderation"
                      ]
                    },
                    {
                      "type": "null"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "reactions": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "reaction": {
                        "type": "string",
                        "enum": [
                          "like",
                          "love",
                          "celebrate",
                          "laugh",
                          "surprised",
                          "sad"
                        ]
                      },
                      "count": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "viewerPresent": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "reaction",
                      "count",
                      "viewerPresent"
                    ],
                    "additionalProperties": false
                  }
                },
                "attachments": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string",
                        "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "rootEventId": {
                        "type": "string",
                        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "target": {
                        "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                      },
                      "targetEntryId": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "contentType": {
                        "type": "string",
                        "enum": [
                          "image/jpeg",
                          "image/png",
                          "image/webp"
                        ]
                      },
                      "byteCount": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20971520
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      },
                      "caption": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "integrityStatus": {
                        "type": "string",
                        "enum": [
                          "integrity_verified"
                        ]
                      },
                      "version": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "rootRevision": {
                        "type": "string",
                        "pattern": "^[1-9]\\d*$"
                      },
                      "createdAt": {
                        "type": "string",
                        "format": "date-time"
                      }
                    },
                    "required": [
                      "id",
                      "rootEventId",
                      "target",
                      "targetEntryId",
                      "contentType",
                      "byteCount",
                      "sha256",
                      "caption",
                      "integrityStatus",
                      "version",
                      "rootRevision",
                      "createdAt"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "id",
                "rootEventId",
                "eventId",
                "parentEntryId",
                "authorUserId",
                "kind",
                "payloadSchemaVersion",
                "body",
                "version",
                "rootRevision",
                "createdRootRevision",
                "createdAt",
                "updatedAt",
                "deletedAt",
                "tombstoneReason",
                "reactions",
                "attachments"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "entry"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedEntriesList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/feed",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "eventId",
      "kind",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "rootEventId": {
                    "type": "string",
                    "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "eventId": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "parentEntryId": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                  },
                  "authorUserId": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "pattern": "^usr_[a-f0-9]{32}$"
                  },
                  "kind": {
                    "type": "string",
                    "enum": [
                      "message",
                      "comment",
                      "system"
                    ]
                  },
                  "payloadSchemaVersion": {
                    "type": "number",
                    "enum": [
                      1
                    ]
                  },
                  "body": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "minLength": 1,
                    "maxLength": 10000
                  },
                  "version": {
                    "type": "integer",
                    "exclusiveMinimum": 0
                  },
                  "rootRevision": {
                    "type": "string",
                    "pattern": "^[1-9]\\d*$"
                  },
                  "createdRootRevision": {
                    "type": "string",
                    "pattern": "^[1-9]\\d*$"
                  },
                  "createdAt": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "updatedAt": {
                    "type": "string",
                    "format": "date-time"
                  },
                  "deletedAt": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "format": "date-time"
                  },
                  "tombstoneReason": {
                    "anyOf": [
                      {
                        "type": "string",
                        "enum": [
                          "author",
                          "moderation"
                        ]
                      },
                      {
                        "type": "null"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "reactions": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "reaction": {
                          "type": "string",
                          "enum": [
                            "like",
                            "love",
                            "celebrate",
                            "laugh",
                            "surprised",
                            "sad"
                          ]
                        },
                        "count": {
                          "type": "integer",
                          "exclusiveMinimum": 0
                        },
                        "viewerPresent": {
                          "type": "boolean"
                        }
                      },
                      "required": [
                        "reaction",
                        "count",
                        "viewerPresent"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "attachments": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "properties": {
                        "id": {
                          "type": "string",
                          "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "rootEventId": {
                          "type": "string",
                          "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "target": {
                          "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                        },
                        "targetEntryId": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                        },
                        "contentType": {
                          "type": "string",
                          "enum": [
                            "image/jpeg",
                            "image/png",
                            "image/webp"
                          ]
                        },
                        "byteCount": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 20971520
                        },
                        "sha256": {
                          "type": "string",
                          "pattern": "^[a-f0-9]{64}$"
                        },
                        "caption": {
                          "type": [
                            "string",
                            "null"
                          ],
                          "minLength": 1,
                          "maxLength": 1000
                        },
                        "integrityStatus": {
                          "type": "string",
                          "enum": [
                            "integrity_verified"
                          ]
                        },
                        "version": {
                          "type": "integer",
                          "exclusiveMinimum": 0
                        },
                        "rootRevision": {
                          "type": "string",
                          "pattern": "^[1-9]\\d*$"
                        },
                        "createdAt": {
                          "type": "string",
                          "format": "date-time"
                        }
                      },
                      "required": [
                        "id",
                        "rootEventId",
                        "target",
                        "targetEntryId",
                        "contentType",
                        "byteCount",
                        "sha256",
                        "caption",
                        "integrityStatus",
                        "version",
                        "rootRevision",
                        "createdAt"
                      ],
                      "additionalProperties": false
                    }
                  }
                },
                "required": [
                  "id",
                  "rootEventId",
                  "eventId",
                  "parentEntryId",
                  "authorUserId",
                  "kind",
                  "payloadSchemaVersion",
                  "body",
                  "version",
                  "rootRevision",
                  "createdRootRevision",
                  "createdAt",
                  "updatedAt",
                  "deletedAt",
                  "tombstoneReason",
                  "reactions",
                  "attachments"
                ],
                "additionalProperties": false
              }
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedEntriesRemove",
    "method": "DELETE",
    "path": "/core/v1/event-roots/{rootEventId}/feed/{entryId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "entryId",
      "rootEventId"
    ],
    "queryParameters": [
      "baseVersion"
    ],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "entry": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "eventId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "parentEntryId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "authorUserId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^usr_[a-f0-9]{32}$"
                },
                "kind": {
                  "type": "string",
                  "enum": [
                    "message",
                    "comment",
                    "system"
                  ]
                },
                "payloadSchemaVersion": {
                  "type": "number",
                  "enum": [
                    1
                  ]
                },
                "body": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "minLength": 1,
                  "maxLength": 10000
                },
                "version": {
                  "type": "integer",
                  "exclusiveMinimum": 0
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdRootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "updatedAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "deletedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "tombstoneReason": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "author",
                        "moderation"
                      ]
                    },
                    {
                      "type": "null"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "reactions": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "reaction": {
                        "type": "string",
                        "enum": [
                          "like",
                          "love",
                          "celebrate",
                          "laugh",
                          "surprised",
                          "sad"
                        ]
                      },
                      "count": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "viewerPresent": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "reaction",
                      "count",
                      "viewerPresent"
                    ],
                    "additionalProperties": false
                  }
                },
                "attachments": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string",
                        "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "rootEventId": {
                        "type": "string",
                        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "target": {
                        "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                      },
                      "targetEntryId": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "contentType": {
                        "type": "string",
                        "enum": [
                          "image/jpeg",
                          "image/png",
                          "image/webp"
                        ]
                      },
                      "byteCount": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20971520
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      },
                      "caption": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "integrityStatus": {
                        "type": "string",
                        "enum": [
                          "integrity_verified"
                        ]
                      },
                      "version": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "rootRevision": {
                        "type": "string",
                        "pattern": "^[1-9]\\d*$"
                      },
                      "createdAt": {
                        "type": "string",
                        "format": "date-time"
                      }
                    },
                    "required": [
                      "id",
                      "rootEventId",
                      "target",
                      "targetEntryId",
                      "contentType",
                      "byteCount",
                      "sha256",
                      "caption",
                      "integrityStatus",
                      "version",
                      "rootRevision",
                      "createdAt"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "id",
                "rootEventId",
                "eventId",
                "parentEntryId",
                "authorUserId",
                "kind",
                "payloadSchemaVersion",
                "body",
                "version",
                "rootRevision",
                "createdRootRevision",
                "createdAt",
                "updatedAt",
                "deletedAt",
                "tombstoneReason",
                "reactions",
                "attachments"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "entry"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedEntriesRevise",
    "method": "PATCH",
    "path": "/core/v1/event-roots/{rootEventId}/feed/{entryId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "entryId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "entry": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "eventId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "parentEntryId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "authorUserId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "pattern": "^usr_[a-f0-9]{32}$"
                },
                "kind": {
                  "type": "string",
                  "enum": [
                    "message",
                    "comment",
                    "system"
                  ]
                },
                "payloadSchemaVersion": {
                  "type": "number",
                  "enum": [
                    1
                  ]
                },
                "body": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "minLength": 1,
                  "maxLength": 10000
                },
                "version": {
                  "type": "integer",
                  "exclusiveMinimum": 0
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdRootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "createdAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "updatedAt": {
                  "type": "string",
                  "format": "date-time"
                },
                "deletedAt": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "format": "date-time"
                },
                "tombstoneReason": {
                  "anyOf": [
                    {
                      "type": "string",
                      "enum": [
                        "author",
                        "moderation"
                      ]
                    },
                    {
                      "type": "null"
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "reactions": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "reaction": {
                        "type": "string",
                        "enum": [
                          "like",
                          "love",
                          "celebrate",
                          "laugh",
                          "surprised",
                          "sad"
                        ]
                      },
                      "count": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "viewerPresent": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "reaction",
                      "count",
                      "viewerPresent"
                    ],
                    "additionalProperties": false
                  }
                },
                "attachments": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string",
                        "pattern": "^att_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "rootEventId": {
                        "type": "string",
                        "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "target": {
                        "$ref": "#/components/schemas/EventServiceAttachmentTarget"
                      },
                      "targetEntryId": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                      },
                      "contentType": {
                        "type": "string",
                        "enum": [
                          "image/jpeg",
                          "image/png",
                          "image/webp"
                        ]
                      },
                      "byteCount": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20971520
                      },
                      "sha256": {
                        "type": "string",
                        "pattern": "^[a-f0-9]{64}$"
                      },
                      "caption": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "minLength": 1,
                        "maxLength": 1000
                      },
                      "integrityStatus": {
                        "type": "string",
                        "enum": [
                          "integrity_verified"
                        ]
                      },
                      "version": {
                        "type": "integer",
                        "exclusiveMinimum": 0
                      },
                      "rootRevision": {
                        "type": "string",
                        "pattern": "^[1-9]\\d*$"
                      },
                      "createdAt": {
                        "type": "string",
                        "format": "date-time"
                      }
                    },
                    "required": [
                      "id",
                      "rootEventId",
                      "target",
                      "targetEntryId",
                      "contentType",
                      "byteCount",
                      "sha256",
                      "caption",
                      "integrityStatus",
                      "version",
                      "rootRevision",
                      "createdAt"
                    ],
                    "additionalProperties": false
                  }
                }
              },
              "required": [
                "id",
                "rootEventId",
                "eventId",
                "parentEntryId",
                "authorUserId",
                "kind",
                "payloadSchemaVersion",
                "body",
                "version",
                "rootRevision",
                "createdRootRevision",
                "createdAt",
                "updatedAt",
                "deletedAt",
                "tombstoneReason",
                "reactions",
                "attachments"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "entry"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventFeedReactionsSet",
    "method": "PUT",
    "path": "/core/v1/event-roots/{rootEventId}/feed/{entryId}/reaction",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "entryId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "reaction": {
              "type": "object",
              "properties": {
                "rootEventId": {
                  "type": "string",
                  "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
                },
                "entryId": {
                  "type": "string",
                  "pattern": "^fed_[A-Za-z0-9._:-]{1,96}$"
                },
                "userId": {
                  "type": "string",
                  "pattern": "^usr_[a-f0-9]{32}$"
                },
                "reaction": {
                  "type": "string",
                  "enum": [
                    "like",
                    "love",
                    "celebrate",
                    "laugh",
                    "surprised",
                    "sad"
                  ]
                },
                "present": {
                  "type": "boolean"
                },
                "version": {
                  "type": "integer",
                  "exclusiveMinimum": 0
                },
                "rootRevision": {
                  "type": "string",
                  "pattern": "^[1-9]\\d*$"
                },
                "updatedAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "required": [
                "rootEventId",
                "entryId",
                "userId",
                "reaction",
                "present",
                "version",
                "rootRevision",
                "updatedAt"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "reaction"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventInvitationsCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/invitations",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "invitation": {
              "$ref": "#/components/schemas/EventServiceEventInvitation"
            },
            "token": {
              "type": "string"
            }
          },
          "required": [
            "invitation"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventInvitationsList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/invitations",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEventInvitationAdminSummary"
              },
              "maxItems": 200
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventInvitationsPreview",
    "method": "POST",
    "path": "/core/v1/invitations/preview",
    "auth": "public",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "rootEventId": {
              "type": "string",
              "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
            },
            "title": {
              "type": "string"
            },
            "startsAt": {
              "type": [
                "string",
                "null"
              ],
              "format": "date-time"
            },
            "endsAt": {
              "type": [
                "string",
                "null"
              ],
              "format": "date-time"
            },
            "role": {
              "type": "string",
              "enum": [
                "organizer",
                "participant",
                "viewer"
              ]
            },
            "emailBound": {
              "type": "boolean"
            },
            "usable": {
              "type": "boolean"
            }
          },
          "required": [
            "rootEventId",
            "title",
            "startsAt",
            "endsAt",
            "role",
            "emailBound",
            "usable"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventInvitationsRedeem",
    "method": "POST",
    "path": "/core/v1/invitations/redeem",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "membership": {
              "$ref": "#/components/schemas/EventServiceEventMembership"
            }
          },
          "required": [
            "membership"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventInvitationsRevoke",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/invitations/{invitationId}/revoke",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "invitationId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "invitation": {
              "$ref": "#/components/schemas/EventServiceEventInvitation"
            },
            "token": {
              "type": "string"
            }
          },
          "required": [
            "invitation"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventItineraryItemsCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/itinerary",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "item": {
              "$ref": "#/components/schemas/EventServiceItineraryItem"
            }
          },
          "required": [
            "item"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventItineraryItemsList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}/itinerary",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceItineraryItem"
              }
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventItineraryItemsReorder",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}/itinerary/reorder",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            },
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceItineraryItem"
              }
            }
          },
          "required": [
            "event",
            "items"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventItineraryItemsUpdate",
    "method": "PATCH",
    "path": "/core/v1/event-roots/{rootEventId}/itinerary/{itemId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "itemId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "item": {
              "$ref": "#/components/schemas/EventServiceItineraryItem"
            }
          },
          "required": [
            "item"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventMemberDirectoryGet",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/member-directory",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/MemberDirectoryPage"
        }
      }
    ]
  },
  {
    "operationId": "eventMembershipsList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/memberships",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEventMembership"
              }
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventMembershipsUpdate",
    "method": "PATCH",
    "path": "/core/v1/event-roots/{rootEventId}/memberships/{userId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId",
      "userId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "membership": {
              "$ref": "#/components/schemas/EventServiceEventMembership"
            }
          },
          "required": [
            "membership"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventOwnershipTransfer",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/ownership/transfer",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "memberships": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEventMembership"
              }
            }
          },
          "required": [
            "memberships"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventPlacesCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/places",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "place": {
              "$ref": "#/components/schemas/EventServiceEventPlace"
            }
          },
          "required": [
            "place"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventPlacesList",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/places",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "cursor",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEventPlace"
              }
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventPlacesUpdate",
    "method": "PATCH",
    "path": "/core/v1/event-roots/{rootEventId}/places/{placeId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "placeId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "place": {
              "$ref": "#/components/schemas/EventServiceEventPlace"
            }
          },
          "required": [
            "place"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventPublishReadinessGet",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/publish-readiness",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/EventServiceEventPublishReadiness"
        }
      }
    ]
  },
  {
    "operationId": "eventRecapExternalGrantsDecide",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/recap/external-grants",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "decision": {
              "type": "string",
              "enum": [
                "grant",
                "withdraw"
              ]
            }
          },
          "required": [
            "decision"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapExternalShareLinksCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/recap/external-share-links",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "shareLink": {
              "$ref": "#/components/schemas/EventServiceEventRecapShareLink"
            },
            "token": {
              "type": "string",
              "pattern": "^crs_[A-Za-z0-9_-]{43}$"
            }
          },
          "required": [
            "shareLink",
            "token"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapExternalShareLinksResolve",
    "method": "POST",
    "path": "/core/v1/recap-external-share-links/resolve",
    "auth": "public",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "recap": {
              "$ref": "#/components/schemas/EventServiceEventRecapExternalShare"
            }
          },
          "required": [
            "recap"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapsGenerate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/recap/generate",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "recap": {
              "$ref": "#/components/schemas/EventServiceEventRecap"
            }
          },
          "required": [
            "recap"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapsGet",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/recap",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [
      "version"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "recap": {
              "$ref": "#/components/schemas/EventServiceEventRecap"
            },
            "externalConsent": {
              "$ref": "#/components/schemas/EventServiceEventRecapExternalConsent"
            }
          },
          "required": [
            "recap",
            "externalConsent"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapShareLinksCreate",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/recap/share-links",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "shareLink": {
              "$ref": "#/components/schemas/EventServiceEventRecapShareLink"
            },
            "token": {
              "type": "string",
              "pattern": "^crs_[A-Za-z0-9_-]{43}$"
            }
          },
          "required": [
            "shareLink",
            "token"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapShareLinksResolve",
    "method": "POST",
    "path": "/core/v1/recap-share-links/resolve",
    "auth": "public",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "recap": {
              "$ref": "#/components/schemas/EventServiceEventRecapShare"
            }
          },
          "required": [
            "recap"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapShareLinksRevoke",
    "method": "DELETE",
    "path": "/core/v1/event-roots/{rootEventId}/recap/share-links/{shareLinkId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId",
      "shareLinkId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "revoked": {
              "type": "boolean",
              "enum": [
                true
              ]
            }
          },
          "required": [
            "revoked"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapsPublish",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/recap/publish",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "recap": {
              "$ref": "#/components/schemas/EventServiceEventRecap"
            }
          },
          "required": [
            "recap"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRecapsRemove",
    "method": "DELETE",
    "path": "/core/v1/event-roots/{rootEventId}/recap",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "removed": {
              "type": "boolean",
              "enum": [
                true
              ]
            },
            "lifecycleVersion": {
              "type": "integer",
              "exclusiveMinimum": 0,
              "maximum": 2147483647
            }
          },
          "required": [
            "removed",
            "lifecycleVersion"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventRootsList",
    "method": "GET",
    "path": "/core/v1/event-roots",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [
      "cursor",
      "includeArchived",
      "limit"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEventRootSummary"
              },
              "maxItems": 200
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsArchive",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}/archive",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsCreate",
    "method": "POST",
    "path": "/core/v1/event-roots",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsDelete",
    "method": "DELETE",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [
      "baseVersion",
      "subtree"
    ],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "deleted": {
              "type": "boolean",
              "enum": [
                true
              ]
            }
          },
          "required": [
            "deleted"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsGet",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsPublish",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/publish",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsReparent",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}/reparent",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsTreeGet",
    "method": "GET",
    "path": "/core/v1/event-roots/{rootEventId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "rootEventId": {
              "type": "string",
              "pattern": "^evt_[A-Za-z0-9._:-]{1,96}$"
            },
            "rootRevision": {
              "type": "string"
            },
            "events": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEvent"
              }
            },
            "capabilities": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEventCapability"
              }
            }
          },
          "required": [
            "rootEventId",
            "rootRevision",
            "events",
            "capabilities"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventsUpdate",
    "method": "PATCH",
    "path": "/core/v1/event-roots/{rootEventId}/events/{eventId}",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "eventId",
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "event": {
              "$ref": "#/components/schemas/EventServiceEvent"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "eventTemplateAdopt",
    "method": "POST",
    "path": "/core/v1/event-roots/{rootEventId}/template",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "rootEventId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/EventServiceEventTemplateAdoptionResponse"
        }
      }
    ]
  },
  {
    "operationId": "eventTemplatesList",
    "method": "GET",
    "path": "/core/v1/event-templates",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "templates": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServiceEventTemplate"
              },
              "minItems": 3,
              "maxItems": 3
            }
          },
          "required": [
            "templates"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "feedbackCommentsCreate",
    "method": "POST",
    "path": "/core/v1/feedback/{feedbackId}/comments",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "feedbackId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceFeedback"
            }
          },
          "required": [
            "feedback"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "feedbackCreate",
    "method": "POST",
    "path": "/core/v1/feedback",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 201,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceFeedback"
            }
          },
          "required": [
            "feedback"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "feedbackDuplicateMark",
    "method": "POST",
    "path": "/core/v1/feedback/{feedbackId}/duplicate",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "feedbackId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceFeedback"
            }
          },
          "required": [
            "feedback"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "feedbackGet",
    "method": "GET",
    "path": "/core/v1/feedback/{feedbackId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "feedbackId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceFeedback"
            }
          },
          "required": [
            "feedback"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "feedbackStatusSet",
    "method": "PUT",
    "path": "/core/v1/feedback/{feedbackId}/status",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "feedbackId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceFeedback"
            }
          },
          "required": [
            "feedback"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "feedbackVotesSet",
    "method": "PUT",
    "path": "/core/v1/feedback/{feedbackId}/vote",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "feedbackId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "feedback": {
              "$ref": "#/components/schemas/EventServiceFeedback"
            }
          },
          "required": [
            "feedback"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "identityMagicLinksCreate",
    "method": "POST",
    "path": "/core/v1/auth/magic-links",
    "auth": "public",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 202,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "accepted": {
              "type": "boolean",
              "enum": [
                true
              ]
            }
          },
          "required": [
            "accepted"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "identityMagicLinksRedeem",
    "method": "POST",
    "path": "/core/v1/auth/magic-links/redeem",
    "auth": "public",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/UserServiceSession"
        }
      }
    ]
  },
  {
    "operationId": "identitySessionsRefresh",
    "method": "POST",
    "path": "/core/v1/auth/refresh",
    "auth": "public",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/UserServiceSession"
        }
      }
    ]
  },
  {
    "operationId": "identitySessionsRevoke",
    "method": "POST",
    "path": "/core/v1/auth/logout",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 204,
        "contentType": null
      }
    ]
  },
  {
    "operationId": "placeEnrichmentJobsCreate",
    "method": "POST",
    "path": "/core/v1/places/enrichment-jobs",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 202,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "enrichment": {
              "$ref": "#/components/schemas/EventServicePlaceEnrichment"
            },
            "place": {
              "$ref": "#/components/schemas/EventServiceEnrichedPlace"
            }
          },
          "required": [
            "enrichment",
            "place"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "placeEnrichmentJobsGet",
    "method": "GET",
    "path": "/core/v1/places/enrichment-jobs/{jobId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "jobId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "enrichment": {
              "$ref": "#/components/schemas/EventServicePlaceEnrichment"
            },
            "place": {
              "$ref": "#/components/schemas/EventServiceEnrichedPlace"
            }
          },
          "required": [
            "enrichment",
            "place"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "placeEnrichmentJobsRetry",
    "method": "POST",
    "path": "/core/v1/places/enrichment-jobs/{jobId}/retry",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [
      "jobId"
    ],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 202,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "enrichment": {
              "$ref": "#/components/schemas/EventServicePlaceEnrichment"
            },
            "place": {
              "$ref": "#/components/schemas/EventServiceEnrichedPlace"
            }
          },
          "required": [
            "enrichment",
            "place"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "placesSearch",
    "method": "GET",
    "path": "/core/v1/places/search",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [
      "countryCode",
      "cursor",
      "kind",
      "limit",
      "q",
      "status"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/EventServicePlaceSearchResult"
              },
              "maxItems": 50
            },
            "pageInfo": {
              "type": "object",
              "properties": {
                "nextCursor": {
                  "type": [
                    "string",
                    "null"
                  ]
                },
                "hasMore": {
                  "type": "boolean"
                }
              },
              "required": [
                "nextCursor",
                "hasMore"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "items",
            "pageInfo"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "syncBootstrapRead",
    "method": "GET",
    "path": "/core/v1/sync/bootstrap",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [
      "cursor",
      "limit",
      "rootEventId"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/EventServiceSyncBootstrapResponse"
        }
      }
    ]
  },
  {
    "operationId": "syncChangesList",
    "method": "GET",
    "path": "/core/v1/sync/pull",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [
      "cursor",
      "limit",
      "rootEventId"
    ],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/EventServiceSyncPullResponse"
        }
      }
    ]
  },
  {
    "operationId": "syncMutationsApply",
    "method": "POST",
    "path": "/core/v1/sync/push",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/EventServiceSyncPushResponse"
        }
      }
    ]
  },
  {
    "operationId": "usersDevicesDelete",
    "method": "DELETE",
    "path": "/core/v1/me/devices/{installationId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "installationId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 204,
        "contentType": null
      }
    ]
  },
  {
    "operationId": "usersDevicesList",
    "method": "GET",
    "path": "/core/v1/me/devices",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "type": "object",
          "properties": {
            "items": {
              "type": "array",
              "items": {
                "$ref": "#/components/schemas/UserServiceDevice"
              }
            }
          },
          "required": [
            "items"
          ],
          "additionalProperties": false
        }
      }
    ]
  },
  {
    "operationId": "usersDevicesUpsert",
    "method": "PUT",
    "path": "/core/v1/me/devices/{installationId}",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [
      "installationId"
    ],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/UserServiceDevice"
        }
      }
    ]
  },
  {
    "operationId": "usersMeGet",
    "method": "GET",
    "path": "/core/v1/me",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/UserServiceUser"
        }
      }
    ]
  },
  {
    "operationId": "usersMeUpdate",
    "method": "PATCH",
    "path": "/core/v1/me",
    "auth": "required",
    "idempotency": "required",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [
      "idempotency-key"
    ],
    "hasJsonBody": true,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/UserServiceProfile"
        }
      }
    ]
  },
  {
    "operationId": "usersSessionGet",
    "method": "GET",
    "path": "/core/v1/session",
    "auth": "required",
    "idempotency": "none",
    "pathParameters": [],
    "queryParameters": [],
    "headerParameters": [],
    "hasJsonBody": false,
    "successResponses": [
      {
        "status": 200,
        "contentType": "application/json",
        "schema": {
          "$ref": "#/components/schemas/Session"
        }
      }
    ]
  }
];
