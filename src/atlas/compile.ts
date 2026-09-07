import type { Route, RouteStep } from './types.ts';

/**
 * The route compiler.
 *
 * CALL-E's create-call API takes exactly six fields, and none of them carries navigation.
 * There is no `dtmf`, no `ivr`, no route parameter — the entire Atlas has to be expressed in
 * the one channel the API does accept: the English text of `task`.
 *
 * So this module is the load-bearing piece of Kol. A stored route graph goes in;
 * instructions precise enough to skip six minutes of menu and hold come out. If prose cannot
 * steer navigation, replay is impossible and the product is only Explore.
 *
 * Three rules the generated prose must always keep:
 *
 *   1. Disclose. Every call says what it is, unprompted. Non-negotiable, and it is also the
 *      law in a growing number of the places CALL-E can dial.
 *   2. Never trust the route over your ears. A cached route is a hint, not an instruction.
 *      The call is told, in the same breath, what to do when the tree has moved — which is
 *      what lets a single call both use the Atlas and repair it.
 *   3. Ask, never commit. Kol collects a status. It does not agree to anything, and it
 *      says so, so a helpful representative cannot talk it into a commitment.
 */

export interface CompileInput {
  /** What we are trying to find out once a human is reached. */
  question: string;
  /** The department, in the words that worked on this line. */
  targetName: string;
  /** Optional reference the callee can look up, e.g. a claim number. */
  reference?: string;
  /** A known route to replay. Omit for exploration. */
  route?: Route;
}

const DISCLOSURE =
  'Open the call by saying plainly that you are an automated assistant calling on behalf of ' +
  'the account holder, and say why you are calling. If you are asked whether you are a real ' +
  'person, say no. Never claim to be a human.';

const BOUNDARIES =
  'You are gathering information only. Do not agree to anything, do not accept an offer, do ' +
  'not authorise a payment, a change, or a cancellation, and do not provide any detail that ' +
  'was not given to you above. If the representative asks for information you were not given, ' +
  'say you will have to check and let a person follow up.';

const REPORTING =
  'When the call ends, report for every menu you heard: the level, what the menu said, the ' +
  'options it offered, and exactly which key you pressed or which words you spoke to get past ' +
  'it. Report these even if the call failed. Report the answer only in the words you were ' +
  'actually told; if you did not get a clear answer, say so rather than guessing.';

function describeStep(step: RouteStep): string {
  const { action, level } = step;
  const where = level === 1 ? 'At the first menu' : `At menu level ${level}`;
  if (action.type === 'dtmf') return `${where}, press ${action.value}.`;
  if (action.type === 'speech') return `${where}, say "${action.value}".`;
  if (action.type === 'wait') return `${where}, wait and do not press anything.`;
  return `${where}, take no action.`;
}

/** Prose for a line we have never mapped. Expensive: this call pays the full menu. */
export function compileExploreTask(input: CompileInput): string {
  const reference = input.reference
    ? ` The reference to quote is ${input.reference}.`
    : '';
  return [
    `Call this line and reach ${input.targetName}.`,
    DISCLOSURE,
    'This line answers with an automated phone menu. Listen to the whole menu before choosing, ' +
      `pick the option that leads to ${input.targetName}, and use the keypad when the menu asks ` +
      'for a key. If a menu leads somewhere unhelpful, go back and try the option that best ' +
      'matches. If you are placed on hold, stay on the line and wait.',
    `Once you reach a person, ask: ${asSentence(input.question)}${reference}`,
    BOUNDARIES,
    REPORTING,
  ].join(' ');
}

/**
 * Prose for a line we have mapped. The route is stated as a shortcut, immediately followed by
 * the conditions under which it must be abandoned — a route that cannot be questioned is a
 * route that walks confidently into the wrong department.
 */
export function compileReplayTask(input: CompileInput): string {
  const route = input.route;
  if (!route || route.steps.length === 0) return compileExploreTask(input);

  const directions = route.steps.map(describeStep).join(' ');
  const expected = route.steps
    .map((s) => `at level ${s.level} you should hear a menu offering ${summariseHeard(s.heard)}`)
    .join('; ');
  const reference = input.reference ? ` The reference to quote is ${input.reference}.` : '';
  const holdHint = route.hold
    ? ` Expect to wait on hold for roughly ${Math.round(route.hold.p50Seconds)} seconds; stay on the line.`
    : '';

  return [
    `Call this line and reach ${route.targetName}.`,
    DISCLOSURE,
    `This line answers with an automated phone menu, and the way through is already known: ${directions}`,
    `You do not need to explore the other options.${holdHint}`,
    `Check as you go: ${expected}.`,
    'If what you actually hear does not match that, stop following these directions ' +
      `immediately, navigate to ${route.targetName} yourself by listening to the real menu, and ` +
      'say clearly in your report that the menu had changed and what it says now.',
    `Once you reach a person, ask: ${asSentence(input.question)}${reference}`,
    BOUNDARIES,
    REPORTING,
  ].join(' ');
}

/** Generated prose is read aloud by a model; a missing stop runs two sentences together. */
function asSentence(text: string): string {
  const t = text.trim();
  return /[.?!]$/.test(t) ? t : `${t}.`;
}

/** A short, human-readable gist of a stored prompt, for use inside generated prose. */
function summariseHeard(heard: string): string {
  const trimmed = heard.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= 160) return `"${trimmed}"`;
  return `"${trimmed.slice(0, 157)}..."`;
}

export function compileTask(input: CompileInput): { task: string; mode: 'explore' | 'replay' } {
  if (input.route && input.route.steps.length > 0) {
    return { task: compileReplayTask(input), mode: 'replay' };
  }
  return { task: compileExploreTask(input), mode: 'explore' };
}
