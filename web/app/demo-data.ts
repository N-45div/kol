export type ClaimState = 'verified' | 'review' | 'contradicted' | 'queued';

export interface DemoClaim {
  id: string;
  payer: string;
  amount: string;
  serviceDate: string;
  state: ClaimState;
  label: string;
  mode: 'Explore' | 'Replay';
  answer: { status: string; amount: string; date: string; action: string };
  route: string[];
  routeReceipt?: string[];
  destination: string;
  reason: string;
  transcript: { time: string; speaker: 'Kol' | 'Payer'; text: string; evidence?: boolean }[];
}

export const claims: DemoClaim[] = [
  {
    id: 'CLM-4471', payer: 'Northstar Health', amount: '$1,240', serviceDate: 'Jul 18, 2026',
    state: 'verified', label: 'Verified', mode: 'Replay',
    answer: { status: 'Paid', amount: '$1,240.00', date: 'Aug 12, 2026', action: 'Post payment' },
    route: ['2 · Claims', '1 · Existing claim', 'Wait · Representative'],
    routeReceipt: ['2 · Claims', '1 · Existing claim', 'Wait · Representative'],
    destination: 'Claims status department', reason: 'All required witnesses agree.',
    transcript: [
      { time: '00:04', speaker: 'Kol', text: 'I am an automated assistant calling about a fictional claim.' },
      { time: '00:19', speaker: 'Payer', text: 'Claims status department.', evidence: true },
      { time: '00:24', speaker: 'Kol', text: 'What is the current status of claim 4471?', evidence: true },
      { time: '00:31', speaker: 'Payer', text: 'Claim 4471 was paid $1,240 on August 12.', evidence: true },
    ],
  },
  {
    id: 'CLM-8130', payer: 'Harbor Benefit', amount: '$860', serviceDate: 'Jul 29, 2026',
    state: 'review', label: 'Needs review', mode: 'Explore',
    answer: { status: 'Pending', amount: '—', date: '—', action: 'Read transcript' },
    route: ['3 · Provider menu', '2 · Claims'], destination: 'Claims department',
    reason: 'No independent route receipt was available.',
    transcript: [
      { time: '00:05', speaker: 'Kol', text: 'I am an automated assistant calling about a fictional claim.' },
      { time: '00:47', speaker: 'Payer', text: 'You have reached claims.', evidence: true },
      { time: '00:51', speaker: 'Kol', text: 'What is the current status of claim 8130?', evidence: true },
      { time: '01:02', speaker: 'Payer', text: 'Claim 8130 remains under review.', evidence: true },
    ],
  },
  {
    id: 'CLM-6502', payer: 'Northstar Health', amount: '$2,410', serviceDate: 'Aug 02, 2026',
    state: 'contradicted', label: 'Contradicted', mode: 'Replay',
    answer: { status: 'Paid', amount: '$2,410.00', date: 'Aug 18, 2026', action: 'Do not post' },
    route: ['2 · Claims', '3 · Provider services'],
    routeReceipt: ['2 · Claims', '3 · Provider services'],
    destination: 'Provider services', reason: 'The figures match, but the wrong department answered.',
    transcript: [
      { time: '00:05', speaker: 'Kol', text: 'I am an automated assistant calling about a fictional claim.' },
      { time: '00:18', speaker: 'Payer', text: 'Provider services department.', evidence: true },
      { time: '00:23', speaker: 'Kol', text: 'What is the current status of claim 6502?', evidence: true },
      { time: '00:34', speaker: 'Payer', text: 'I can see 6502, $2,410, August 18.', evidence: true },
    ],
  },
  {
    id: 'CLM-2918', payer: 'Harbor Benefit', amount: '$2,915', serviceDate: 'Aug 05, 2026',
    state: 'queued', label: 'Queued', mode: 'Replay',
    answer: { status: '—', amount: '—', date: '—', action: 'Run replay' },
    route: ['2 · Claims', '1 · Claim status'], routeReceipt: ['2 · Claims', '1 · Claim status'],
    destination: 'Not called', reason: 'Safe replay fixture has not run yet.', transcript: [],
  },
];

export const evaluationFamilies = [
  ['Clean paid', '80 / 80 accepted', 100],
  ['Clean denied', '80 / 80 accepted', 100],
  ['Fabricated amount', '80 / 80 withheld', 100],
  ['Wrong department', '80 / 80 withheld', 100],
  ['Question never asked', '80 / 80 withheld', 100],
  ['Route mismatch', '80 / 80 withheld', 100],
  ['Missing route receipt', '80 / 80 withheld', 100],
  ['Low confidence', '80 / 80 withheld', 100],
] as const;
