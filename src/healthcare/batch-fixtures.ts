import type { CallRecord, TranscriptTurn } from '../calle/types.ts';
import type { ClaimBatchInput } from './batch.ts';
import type { ClaimOutcome } from './types.ts';

/**
 * Multi-claim fixtures. Three claims are asked on one call; the payer answers each by name.
 * The families cover the failures that only exist once claims share a transcript.
 */
export type BatchFixtureKind =
  | 'batch_clean'
  | 'batch_crossed'
  | 'batch_invented'
  | 'batch_unanswered'
  | 'batch_ambiguous';

export interface BatchFixture {
  id: string;
  kind: BatchFixtureKind;
  input: ClaimBatchInput;
  /** Which of the requested (and any invented) claims should auto-accept, by reference. */
  expectedAutoAccept: Record<string, boolean>;
}

function turn(offset_seconds: number, speaker: 'bot' | 'user', text: string): TranscriptTurn {
  return { offset_seconds, speaker, text };
}

export function makeBatchFixture(kind: BatchFixtureKind, index = 0): BatchFixture {
  const refs = [String(5100 + index * 3), String(5101 + index * 3), String(5102 + index * 3)];
  const amounts = refs.map((_, i) => 900 + index + i * 215);
  const dollars = amounts.map((a) => `$${a.toLocaleString('en-US')}`);
  const questions = refs.map((ref) => `What is the current status of claim ${ref}?`);
  const answers = refs.map((ref, i) => `Claim ${ref} was paid ${dollars[i]} on August 12, 2026.`);
  const department = 'Claims status department.';

  const turns: TranscriptTurn[] = [
    turn(0, 'bot', 'Hello, I am an automated assistant calling about three fictional claims.'),
    turn(6, 'user', department),
  ];
  let t = 10;
  for (let i = 0; i < refs.length; i++) {
    if (kind === 'batch_unanswered' && i === 2) break;
    turns.push(turn(t, 'bot', questions[i]!));
    turns.push(turn(t + 5, 'user', answers[i]!));
    t += 12;
  }

  const outcome = (i: number, overrides: Partial<ClaimOutcome> = {}): ClaimOutcome => ({
    claimReference: refs[i]!,
    status: 'paid',
    department: 'claims status department',
    paidAmount: dollars[i]!,
    paymentDate: '2026-08-12',
    evidence: { destination: department, question: questions[i]!, answer: answers[i]! },
    ...overrides,
  });

  let outcomes: ClaimOutcome[];
  const expectedAutoAccept: Record<string, boolean> = { [refs[0]!]: true, [refs[1]!]: true, [refs[2]!]: true };

  switch (kind) {
    case 'batch_clean':
      outcomes = [outcome(0), outcome(1), outcome(2)];
      break;
    case 'batch_crossed':
      // Claim 0 is filed with claim 1's amount and claim 1's sentence as its proof. Every
      // number was spoken; only the binding is wrong.
      outcomes = [
        outcome(0, { paidAmount: dollars[1]!, evidence: { destination: department, question: questions[0]!, answer: answers[1]! } }),
        outcome(1),
        outcome(2),
      ];
      expectedAutoAccept[refs[0]!] = false;
      break;
    case 'batch_invented': {
      const ghost = String(5900 + index);
      outcomes = [outcome(0), outcome(1), outcome(2), {
        ...outcome(0),
        claimReference: ghost,
        // A perfectly grounded quote, lifted from claim 0, presented as an answer about a claim nobody asked for.
      }];
      expectedAutoAccept[ghost] = false;
      break;
    }
    case 'batch_unanswered':
      outcomes = [outcome(0), outcome(1)];
      expectedAutoAccept[refs[2]!] = false;
      break;
    case 'batch_ambiguous':
      // The quote for claim 0 is real payer speech, but it is the department line: it names no claim.
      outcomes = [outcome(0, { evidence: { destination: department, question: questions[0]!, answer: `It was paid ${dollars[0]} on August 12, 2026.` } }), outcome(1), outcome(2)];
      turns.splice(3, 0, turn(t + 1, 'user', `It was paid ${dollars[0]} on August 12, 2026.`));
      expectedAutoAccept[refs[0]!] = false;
      break;
  }

  const call: CallRecord = {
    id: `call_batch_${kind}_${index}`,
    status: 'completed',
    task_completed: true,
    completion_confidence: { score: 0.93, label: 'high' },
    recipients: [{ attempts: [{ transcript_turns: turns }] }],
  };

  return {
    id: `${kind}-${index}`,
    kind,
    expectedAutoAccept,
    input: {
      call,
      outcomes,
      expectedClaimReferences: refs,
      expectedDepartment: 'claims status department',
      reportedKeys: ['2', '1'],
      routeReceipt: { source: 'fixture_log', keys: ['2', '1'] },
    },
  };
}

export const BATCH_FIXTURE_KINDS: BatchFixtureKind[] = [
  'batch_clean',
  'batch_crossed',
  'batch_invented',
  'batch_unanswered',
  'batch_ambiguous',
];
