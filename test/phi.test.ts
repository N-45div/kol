import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Atlas } from '../src/atlas/store.ts';
import { runChase } from '../src/chase/run.ts';
import { assertNoPhi, findPhi, PhiRefusal } from '../src/healthcare/phi.ts';
import type { CalleTransport } from '../src/calle/types.ts';

const SAFE = [
  'what is the current status of claim 4471',
  'was claim 004425 paid, and on what date',
  'is claim 4471 denied under code CO-16, and what is the appeal deadline',
  'what is the status of the prior authorization request submitted on August 12, 2026',
  'the claims department',
];

for (const text of SAFE) {
  test(`a normal biller question is not PHI: "${text.slice(0, 40)}"`, () => {
    assert.deepEqual(findPhi(text), []);
  });
}

const HOSTILE: [string, string][] = [
  ['social_security_number', 'status of claim 4471 for SSN 123-45-6789'],
  ['date_of_birth', 'claim 4471, patient date of birth 03/14/1982'],
  ['date_of_birth', 'claim 4471, DOB March 14, 1982'],
  ['member_id', 'claim 4471 member ID ABC12345678'],
  ['member_id', 'subscriber number: 99881234'],
  ['medical_record_number', 'MRN 00412345 claim status'],
  ['diagnosis_code', 'claim 4471 with diagnosis E11.9'],
  ['patient_name', 'claim 4471 for patient Jane Example'],
  ['email_address', 'send the EOB to jane@example.com'],
  ['phone_number', 'call the patient back on +1 202 555 0147'],
];

for (const [kind, text] of HOSTILE) {
  test(`${kind} is caught before dialling`, () => {
    const findings = findPhi(text, 'question');
    assert.ok(findings.some((f) => f.kind === kind), `expected ${kind} in ${JSON.stringify(findings)}`);
    assert.equal(findings[0]!.field, 'question');
  });
}

test('the excerpt in a refusal is masked, so the refusal itself carries no PHI', () => {
  const findings = findPhi('member ID ABC12345678');
  assert.equal(findings.length, 1);
  assert.doesNotMatch(findings[0]!.excerpt, /12345678/);
  assert.match(findings[0]!.excerpt, /A•+/);
  assert.throws(() => assertNoPhi({ question: 'member ID ABC12345678' }), (error: unknown) => {
    assert.ok(error instanceof PhiRefusal);
    assert.doesNotMatch(error.message, /12345678/);
    assert.match(error.message, /Refusing to dial/);
    return true;
  });
});

test('a claim number and a dollar amount together are not mistaken for a phone number', () => {
  assert.deepEqual(findPhi('claim 4471 was paid $1,240.00 on 08/12/2026'), []);
});

test('a chase with PHI in the question is refused before any call is placed', async () => {
  let placed = 0;
  const transport: CalleTransport = {
    mode: 'replay',
    async createCall() { placed += 1; throw new Error('should never be reached'); },
    async getCall() { throw new Error('unreachable'); },
    async getEvents() { return []; },
  };
  const atlas = new Atlas(join(mkdtempSync(join(tmpdir(), 'kol-phi-')), 'routes.json'));
  await assert.rejects(
    runChase({
      lineE164: '+15550001111',
      org: 'Fixture Health Plan',
      goal: 'claim_status',
      targetName: 'the claims department',
      question: 'what is the status of claim 4471, member ID ABC12345678',
    }, { transport, atlas, now: '2026-09-12T10:00:00Z' }),
    PhiRefusal,
  );
  assert.equal(placed, 0, 'the transport was never asked to dial');
});
