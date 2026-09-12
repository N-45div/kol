/** One claim's fields, as they appear in the batch contract. */
const CLAIM_ITEM = {
  type: 'object',
  required: ['claim_reference', 'claim_status', 'question_evidence', 'answer_evidence'],
  properties: {
    claim_reference: { type: 'string' },
    claim_status: {
      type: 'string',
      enum: ['paid', 'pending', 'denied', 'rejected', 'needs_information', 'not_found', 'unknown'],
    },
    paid_amount: { type: 'string' },
    payment_date: { type: 'string' },
    denial_code: { type: 'string' },
    next_action: { type: 'string' },
    question_evidence: { type: 'string', description: 'Exact caller words asking about this claim. Empty when never asked.' },
    answer_evidence: {
      type: 'string',
      description: 'Exact payer words answering about this claim, including the claim number as the payer said it. Empty when no answer was obtained.',
    },
  },
} as const;

/**
 * Several claims on one call. The payer is asked to name each claim with its answer, and the
 * batch verifier refuses any answer whose quote does not.
 */
export const CLAIM_BATCH_RESULT_SCHEMA = {
  type: 'object',
  required: ['reached_target', 'target_name_used', 'menu_levels', 'department_evidence', 'claims'],
  properties: {
    reached_target: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    target_name_used: { type: 'string' },
    menu_levels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['level', 'prompt_heard', 'action_type'],
        properties: {
          level: { type: 'integer' },
          prompt_heard: { type: 'string' },
          action_type: { type: 'string', enum: ['dtmf', 'speech', 'wait', 'none'] },
          action_value: { type: 'string' },
        },
      },
    },
    department_evidence: { type: 'string', description: 'Exact payer words establishing the department. Empty when not established.' },
    claims: { type: 'array', items: CLAIM_ITEM },
  },
} as const;

/** Strict claim-status extraction contract sent to CALL-E. */
export const CLAIM_STATUS_RESULT_SCHEMA = {
  type: 'object',
  required: [
    'reached_target',
    'target_name_used',
    'menu_levels',
    'claim_reference',
    'claim_status',
    'department_evidence',
    'question_evidence',
    'answer_evidence',
    'final_answer',
  ],
  properties: {
    reached_target: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    target_name_used: { type: 'string' },
    menu_levels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['level', 'prompt_heard', 'action_type'],
        properties: {
          level: { type: 'integer' },
          prompt_heard: { type: 'string' },
          options_offered: { type: 'array', items: { type: 'string' } },
          action_type: { type: 'string', enum: ['dtmf', 'speech', 'wait', 'none'] },
          action_value: { type: 'string' },
        },
      },
    },
    route_matched_expectation: { type: 'string', enum: ['yes', 'no', 'not_applicable'] },
    hold_seconds_estimate: { type: 'number' },
    claim_reference: { type: 'string' },
    claim_status: {
      type: 'string',
      enum: ['paid', 'pending', 'denied', 'rejected', 'needs_information', 'not_found', 'unknown'],
    },
    paid_amount: { type: 'string' },
    payment_date: { type: 'string' },
    denial_code: { type: 'string' },
    next_action: { type: 'string' },
    department_evidence: {
      type: 'string',
      description: 'Exact payer words establishing the department. Empty when not established.',
    },
    question_evidence: {
      type: 'string',
      description: 'Exact caller words containing the claim-status question. Empty when never asked.',
    },
    answer_evidence: {
      type: 'string',
      description: 'Exact payer words supporting the outcome. Empty when no answer was obtained.',
    },
    final_answer: { type: 'string' },
  },
} as const;
