export const SUMMARY_PROMPT = [
  'Summarize the ECCC bulletin strictly from the provided title/body.',
  'Do not add facts or locations. Preserve uncertainty/conditional language.',
  'If text is short or boilerplate, return null summaries with a reason.',
  'Output JSON only.'
].join(' ');

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary_1line: { type: ['string', 'null'], maxLength: 140 },
    summary_3line: { type: ['string', 'null'], maxLength: 360 },
    summary_null_reason: {
      type: ['string', 'null'],
      enum: ['short_text', 'boilerplate', 'noninformative', 'other', null]
    }
  },
  required: ['summary_1line', 'summary_3line', 'summary_null_reason'],
  additionalProperties: false
} as const;

