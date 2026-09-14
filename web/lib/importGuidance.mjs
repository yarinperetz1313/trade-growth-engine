import { getImportAnalysisTargetDefinition } from "./importContracts.mjs";

const IMPORT_SOURCE_SYSTEM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const IMPORT_SOURCE_SYSTEM_EXAMPLE = "quarterly-crm-export";

export function validateImportSourceSystem(value) {
  if (typeof value !== "string" || value.length === 0) {
    return Object.freeze({
      valid: false,
      message: "Enter a source namespace before canonical commit. Use 1–128 characters and start with a letter or number."
    });
  }
  if (!IMPORT_SOURCE_SYSTEM_PATTERN.test(value)) {
    return Object.freeze({
      valid: false,
      message: `Use a 1–128 character source namespace: start with a letter or number, then use only letters, numbers, periods, underscores, colons, or hyphens. Example: ${IMPORT_SOURCE_SYSTEM_EXAMPLE}. Spaces are not accepted.`
    });
  }
  return Object.freeze({ valid: true, message: null });
}

const COLLECTIONS = Object.freeze([
  Object.freeze({
    collection: "prospects",
    label: "Prospects",
    description: "Business or account records that may include contact routes and qualification evidence."
  }),
  Object.freeze({
    collection: "opportunities",
    label: "Opportunities",
    description: "Sales pipeline records used by the supported stalled-opportunity detector."
  }),
  Object.freeze({
    collection: "tasks",
    label: "Tasks",
    description: "Follow-up work linked to an existing opportunity."
  }),
  Object.freeze({
    collection: "activities",
    label: "Activities",
    description: "Recorded sales activity linked to an opportunity or prospect."
  }),
  Object.freeze({
    collection: "revenue_actions",
    label: "Revenue actions",
    description: "Existing action records can be staged and previewed, but cannot be canonically committed by CSV."
  })
]);

const COLLECTION_GUIDANCE = Object.freeze({
  prospects: Object.freeze({
    sourceIdentityGuidance: "Choose a stable source identity for each prospect. The same CRM record ID may also map to the required id field.",
    fieldGuidance: Object.freeze({
      id: "Stable CRM record ID. It may also be selected as the source identity.",
      business_name: "Business or account name from the source export.",
      email: "Optional contact email. Blank or missing remains unknown.",
      phone: "Optional contact phone. Blank or missing remains unknown.",
      website: "Optional business website. Blank or missing remains unknown."
    })
  }),
  opportunities: Object.freeze({
    sourceIdentityGuidance: "Choose a stable source identity for each opportunity. The same CRM deal ID may also map to the required id field.",
    fieldGuidance: Object.freeze({
      id: "Stable CRM deal ID. It may also be selected as the source identity.",
      business_name: "Business or account name for this deal.",
      stage: "Current source stage. Unknown values are preserved for review.",
      value: "Optional exact deal amount. Missing remains unknown and is never changed to zero.",
      currency: "Optional exact uppercase three-letter currency code such as AUD. Missing remains unknown and is never inferred from locale.",
      probability: "Optional source probability between 0 and 1; health is not inferred as probability.",
      updated_at: "Optional source update timestamp used as evidence exactly as supplied."
    })
  }),
  tasks: Object.freeze({
    sourceIdentityGuidance: "Choose a stable source identity for each task. The same task ID may also map to the required id field.",
    fieldGuidance: Object.freeze({
      id: "Stable CRM task ID. It may also be selected as the source identity.",
      opportunity_id: "ID of the existing opportunity this task belongs to.",
      title: "Task title from the source export.",
      status: "Current source task status. Unknown values are preserved for review."
    })
  }),
  activities: Object.freeze({
    sourceIdentityGuidance: "Choose a stable source identity for each activity. The same activity ID may also map to the required id field.",
    fieldGuidance: Object.freeze({
      id: "Stable CRM activity ID. It may also be selected as the source identity.",
      opportunity_id: "ID of the existing opportunity this activity belongs to.",
      type: "Source activity type, such as call, meeting, or note.",
      created_at: "Optional source activity timestamp used exactly as supplied."
    })
  })
});

const DEFAULT_FIELD_GUIDANCE = Object.freeze({
  created_at: "Optional source creation timestamp used exactly as supplied.",
  updated_at: "Optional source update timestamp used exactly as supplied."
});

export function listImportCollectionCapabilities() {
  return COLLECTIONS.map(({ collection, label, description }) => {
    const target = getImportAnalysisTargetDefinition(collection);
    if (target === null) {
      return Object.freeze({
        collection,
        label,
        description,
        commitSupported: false,
        capabilityLabel: "Preview only",
        fields: Object.freeze([]),
        sourceIdentityGuidance: "Preview preserves staged source evidence, but canonical RevenueAction import is unavailable.",
        templateFilename: null
      });
    }
    const specific = COLLECTION_GUIDANCE[collection];
    return Object.freeze({
      collection,
      label,
      description,
      commitSupported: true,
      capabilityLabel: "Canonical commit supported",
      fields: Object.freeze(target.fields.map(field => Object.freeze({
        ...field,
        guidance: specific.fieldGuidance[field.name]
          || DEFAULT_FIELD_GUIDANCE[field.name]
          || `Optional ${humanize(field.name)} evidence; blank or missing remains unknown.`
      }))),
      sourceIdentityGuidance: specific.sourceIdentityGuidance,
      templateFilename: `tge-${collection}-blank-template.csv`
    });
  });
}

export function getImportCollectionCapability(collection) {
  const capability = listImportCollectionCapabilities().find(item => (
    item.collection === collection
  ));
  return capability || null;
}

export function buildImportTemplateDownload(collection) {
  const capability = getImportCollectionCapability(collection);
  if (!capability?.commitSupported) {
    const error = new Error("A canonical CSV template is unavailable for this preview-only collection.");
    error.name = "ImportTemplateError";
    error.code = "IMPORT_TEMPLATE_UNAVAILABLE";
    throw error;
  }
  const csv = `${capability.fields.map(field => csvHeader(field.name)).join(",")}\n`;
  return Object.freeze({
    filename: capability.templateFilename,
    mediaType: "text/csv;charset=utf-8",
    csv,
    href: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
  });
}

function csvHeader(value) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function humanize(value) {
  return value.replaceAll("_", " ");
}
