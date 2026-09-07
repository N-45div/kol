/**
 * The result_schema Kol asks CALL-E to fill.
 *
 * This is the other half of the trick. Since navigation cannot be passed in as parameters, it
 * has to come back out as structured data — the call reports its own route, and that report is
 * what the Atlas is built from. Every field here exists because something downstream needs it:
 *
 *   menu_levels                 -> becomes the stored route
 *   action_type / action_value  -> the keys to replay
 *   route_matched_expectation   -> lets a single call both use the Atlas and repair it
 *   reached_target              -> stops a failed call from being learned as a good route
 *
 * A self-report is not proof. The fixture echoes the pressed digit back and hides a passphrase
 * at the leaf, so the transcript carries ground truth the model cannot fabricate; these fields
 * are checked against it rather than believed.
 */
export const NAVIGATION_RESULT_SCHEMA = {
  type: 'object',
  required: ['reached_target', 'menu_levels'],
  properties: {
    reached_target: {
      type: 'string',
      enum: ['yes', 'no', 'unclear'],
      description: 'Whether a person or service in the requested department was actually reached.',
    },
    target_name_used: {
      type: 'string',
      description: 'The department name that worked on this line, in the menu’s own words.',
    },
    menu_levels: {
      type: 'array',
      description: 'One entry per automated menu heard, in the order they were heard.',
      items: {
        type: 'object',
        required: ['level', 'prompt_heard', 'action_type'],
        properties: {
          level: { type: 'integer', description: '1 for the first menu.' },
          prompt_heard: { type: 'string', description: 'What the menu said, as heard.' },
          options_offered: {
            type: 'array',
            items: { type: 'string' },
            description: 'Each option and its key, e.g. "claims: 2".',
          },
          action_type: { type: 'string', enum: ['dtmf', 'speech', 'wait', 'none'] },
          action_value: { type: 'string', description: 'The key pressed or the words spoken.' },
        },
      },
    },
    hold_seconds_estimate: {
      type: 'number',
      description: 'Approximate seconds spent waiting on hold before a person answered.',
    },
    route_matched_expectation: {
      type: 'string',
      enum: ['yes', 'no', 'not_applicable'],
      description:
        'If directions were supplied, whether the menus matched them. "not_applicable" when no directions were given.',
    },
    final_answer: {
      type: 'string',
      description: 'The answer in the words actually spoken. Empty if no clear answer was given.',
    },
  },
} as const;
