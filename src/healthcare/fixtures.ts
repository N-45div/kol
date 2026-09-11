import type { CallRecord, TranscriptTurn } from '../calle/types.ts';
import type { ClaimOutcome, RouteReceipt } from './types.ts';
import type { VerifyClaimInput } from './verify.ts';

export type FixtureKind =
  | 'clean_paid'
  | 'clean_denied'
  | 'fabricated_amount'
  | 'wrong_department'
  | 'never_asked'
  | 'route_mismatch'
  | 'missing_route_receipt'
  | 'low_confidence';

export interface ClaimFixture {
  id: string;
  kind: FixtureKind;
  expectedAutoAccept: boolean;
  input: VerifyClaimInput;
}

function turn(offset_seconds: number, speaker: 'bot' | 'user', text: string): TranscriptTurn {
  return { offset_seconds, speaker, text };
}

export function makeClaimFixture(kind: FixtureKind, index = 0): ClaimFixture {
  const claimReference = String(4400 + index);
  const paidAmountNumber = 1200 + index;
  const paidAmount = `$${paidAmountNumber.toLocaleString('en-US')}`;
  const question = `What is the current status of claim ${claimReference}?`;
  const department = kind === 'wrong_department' ? 'Provider services department.' : 'Claims status department.';
  const answer = kind === 'clean_denied'
    ? `Claim ${claimReference} is denied under code CO-16. Please submit the missing report.`
    : `Claim ${claimReference} was paid ${paidAmount} on August 12, 2026.`;
  const outcomeAmount = kind === 'fabricated_amount'
    ? `$${(paidAmountNumber + 180).toLocaleString('en-US')}`
    : paidAmount;

  const outcome: ClaimOutcome = kind === 'clean_denied'
    ? {
        claimReference,
        status: 'denied',
        department: 'claims status department',
        denialCode: 'CO-16',
        nextAction: 'Submit missing report',
        evidence: { destination: department, question, answer },
      }
    : {
        claimReference,
        status: 'paid',
        department: 'claims status department',
        paidAmount: outcomeAmount,
        paymentDate: '2026-08-12',
        nextAction: 'Post payment',
        evidence: { destination: department, question, answer },
      };

  const call: CallRecord = {
    id: `call_fixture_${kind}_${index}`,
    status: 'completed',
    task_completed: true,
    completion_confidence: {
      score: kind === 'low_confidence' ? 0.31 : 0.94,
      label: kind === 'low_confidence' ? 'low' : 'high',
    },
    recipients: [{
      attempts: [{
        transcript_turns: [
          turn(0, 'bot', 'Hello, I am an automated assistant calling about a fictional claim.'),
          turn(7, 'user', department),
          ...(kind === 'never_asked' ? [] : [turn(11, 'bot', question)]),
          turn(17, 'user', answer),
        ],
      }],
    }],
  };

  const routeReceipt: RouteReceipt | undefined = kind === 'missing_route_receipt'
    ? undefined
    : { source: 'fixture_log', keys: kind === 'route_mismatch' ? ['2', '3'] : ['2', '1'] };

  return {
    id: `${kind}-${index}`,
    kind,
    expectedAutoAccept: kind === 'clean_paid' || kind === 'clean_denied',
    input: {
      call,
      outcome,
      expectedClaimReference: claimReference,
      expectedDepartment: 'claims status department',
      reportedKeys: ['2', '1'],
      ...(routeReceipt ? { routeReceipt } : {}),
    },
  };
}

export const FIXTURE_KINDS: FixtureKind[] = [
  'clean_paid',
  'clean_denied',
  'fabricated_amount',
  'wrong_department',
  'never_asked',
  'route_mismatch',
  'missing_route_receipt',
  'low_confidence',
];
