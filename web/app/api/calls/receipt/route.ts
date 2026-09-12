import { NextRequest, NextResponse } from 'next/server';
import { resumeHook } from 'workflow/api';
import { verifyPin } from '@/lib/calle';
import { hookToken, type ReceiptPayload } from '@/workflows/chase';

export const runtime = 'nodejs';

/**
 * The operator's route receipt. Resumes the suspended run for this chase with the tones
 * the person who answered heard, or with null to decline to attest. Either way the run
 * finishes; a declined receipt leaves the verdict under review.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { runKey?: string; pin?: string; heardKeys?: string | null };
    if (!verifyPin(String(body.pin ?? ''))) return NextResponse.json({ error: 'Incorrect demo PIN.' }, { status: 401 });
    const runKey = String(body.runKey ?? '');
    if (!/^[0-9a-f-]{36}$/.test(runKey)) return NextResponse.json({ error: 'Invalid run key.' }, { status: 400 });
    const payload: ReceiptPayload = { heardKeys: typeof body.heardKeys === 'string' ? body.heardKeys : null };
    const result = await resumeHook(hookToken(runKey), payload);
    return NextResponse.json({ resumed: true, runId: result.runId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'The run is not waiting for a receipt.' }, { status: 409 });
  }
}
