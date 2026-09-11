export type ClaimStatus =
  | 'paid'
  | 'pending'
  | 'denied'
  | 'rejected'
  | 'needs_information'
  | 'not_found'
  | 'unknown';

export interface ClaimEvidence {
  /** Exact words from the payer side of the transcript. */
  destination: string;
  /** Exact words supporting the claim outcome and its financial fields. */
  answer: string;
  /** Exact question asked by the CALL-E agent. */
  question: string;
}

export interface ClaimOutcome {
  claimReference: string;
  status: ClaimStatus;
  department: string;
  paidAmount?: string;
  paymentDate?: string;
  denialCode?: string;
  /** Operator-policy recommendation. It is derived, never presented as a payer quote. */
  nextAction?: string;
  evidence: ClaimEvidence;
}

export interface RouteReceipt {
  /** Independent of the model's structured result. */
  source: 'fixture_log' | 'dtmf_audio' | 'provider_event';
  keys: string[];
}

export type ClaimVerdict = 'verified' | 'needs_review' | 'contradicted' | 'unreachable';

export interface WitnessCheck {
  name: string;
  passed: boolean;
  severity: 'required' | 'corroborating';
  detail: string;
}

export interface ClaimVerification {
  verdict: ClaimVerdict;
  checks: WitnessCheck[];
  autoAccept: boolean;
  summary: string;
}
