import { NextRequest, NextResponse } from 'next/server';
import { callingEnabled, createSmokeCall, getCall, publicCallState, validateDestination, verifyPin } from '@/lib/calle';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    if (!callingEnabled()) return NextResponse.json({ error: 'Live calling is disabled on this deployment.' }, { status: 503 });
    const body = await request.json() as { phone?: string; pin?: string; confirmed?: boolean };
    if (!verifyPin(String(body.pin ?? ''))) return NextResponse.json({ error: 'Incorrect demo PIN.' }, { status: 401 });
    if (body.confirmed !== true) return NextResponse.json({ error: 'Exact call authorisation is required.' }, { status: 400 });
    const destination = validateDestination(String(body.phone ?? ''));
    const call = await createSmokeCall(destination);
    return NextResponse.json(publicCallState(call), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Call request failed.' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    if (!verifyPin(request.headers.get('x-kol-demo-pin') ?? '')) return NextResponse.json({ error: 'Incorrect demo PIN.' }, { status: 401 });
    const callId = request.nextUrl.searchParams.get('id') ?? '';
    return NextResponse.json(publicCallState(await getCall(callId)));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Status request failed.' }, { status: 400 });
  }
}
