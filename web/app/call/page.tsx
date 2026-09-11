'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock3, PhoneCall, ShieldCheck, TriangleAlert } from 'lucide-react';

type CallState = { callId: string; status: string; terminal: boolean; phraseHeard: boolean; transcriptTurns: number; failureCode?: string | null };

export default function CallTestPage() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [call, setCall] = useState<CallState | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!call || call.terminal) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/calls?id=${encodeURIComponent(call.callId)}`, { headers: { 'x-kol-demo-pin': pin } });
      const data = await response.json();
      if (response.ok) setCall(data);
      else setError(data.error ?? 'Could not poll the call.');
    }, 6000);
    return () => window.clearInterval(timer);
  }, [call, pin]);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/calls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, pin, confirmed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Call request failed.');
      setCall(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Call request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f7f7f2] px-5 py-8 text-[#102f2a] sm:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#5f726e]"><ArrowLeft className="size-4" /> Back to Kol</Link>
        <div className="mt-8 rounded-[2rem] border border-emerald-950/10 bg-white p-6 shadow-xl shadow-emerald-950/5 sm:p-10">
          <span className="grid size-12 place-items-center rounded-2xl bg-[#153f37] text-white"><PhoneCall className="size-5" /></span>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[.14em] text-emerald-700">Controlled live test</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-.05em]">Make one real CALL-E call.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#627570]">The call identifies itself, asks only for the phrase “Kol test received,” and ends. It does not collect a name, medical data, payment, or any other personal information.</p>

          {!call ? (
            <form onSubmit={submit} className="mt-9 space-y-5">
              <label className="block"><span className="text-sm font-semibold">Authorised recipient number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 00000 00000" autoComplete="tel" className="mt-2 h-12 w-full rounded-xl border border-emerald-950/15 bg-[#fbfcf9] px-4 outline-none focus:ring-2 focus:ring-emerald-700/20" /></label>
              <label className="block"><span className="text-sm font-semibold">Demo PIN</span><input value={pin} onChange={(event) => setPin(event.target.value)} type="password" autoComplete="one-time-code" className="mt-2 h-12 w-full rounded-xl border border-emerald-950/15 bg-[#fbfcf9] px-4 outline-none focus:ring-2 focus:ring-emerald-700/20" /></label>
              <label className="flex cursor-pointer gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4" /><span>I own or am authorised to receive a call at this exact number. I understand a submitted call may cost money and cannot be cancelled through this interface.</span></label>
              {error && <p className="flex items-center gap-2 text-sm font-medium text-rose-700"><TriangleAlert className="size-4" />{error}</p>}
              <button disabled={!confirmed || submitting} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#153f37] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><PhoneCall className="size-4" />{submitting ? 'Submitting once…' : 'Place one test call'}</button>
            </form>
          ) : (
            <div className="mt-9 rounded-3xl bg-[#f3f6f2] p-6">
              <div className="flex items-start gap-4">{call.terminal ? <CheckCircle2 className="mt-1 size-6 text-emerald-700" /> : <Clock3 className="mt-1 size-6 animate-pulse text-amber-700" />}<div><p className="text-lg font-semibold">{call.terminal ? 'Call finished' : 'CALL-E is working'}</p><p className="mt-1 text-sm text-[#667974]">Status: {call.status} · transcript turns: {call.transcriptTurns}</p></div></div>
              {call.terminal && <div className="mt-5 border-t border-emerald-950/10 pt-5"><p className="text-sm font-semibold">Phrase verified: {call.phraseHeard ? 'yes' : 'no or unsupported'}</p>{call.failureCode && <p className="mt-1 text-xs text-rose-700">Failure: {call.failureCode}</p>}<button onClick={() => setCall(null)} className="mt-5 text-sm font-semibold text-emerald-800">Start a new authorised test</button></div>}
              {error && <p className="mt-4 text-sm text-rose-700">{error}</p>}
            </div>
          )}

          <div className="mt-8 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-emerald-950/10 p-4"><ShieldCheck className="size-4 text-emerald-700" /><p className="mt-2 text-sm font-semibold">Allowlist protected</p><p className="mt-1 text-xs leading-5 text-[#6e7e7a]">Even with the PIN, the server calls only pre-approved test destinations.</p></div><div className="rounded-2xl border border-emerald-950/10 p-4"><Clock3 className="size-4 text-emerald-700" /><p className="mt-2 text-sm font-semibold">Duplicate resistant</p><p className="mt-1 text-xs leading-5 text-[#6e7e7a]">Repeated submissions in the same hour reuse one CALL-E idempotency key.</p></div></div>
        </div>
      </div>
    </main>
  );
}
