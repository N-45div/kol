'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  FileCheck2,
  KeyRound,
  PhoneCall,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { applyRouteReceipt, CLAIM_DEMO, ROUTE_DEMO, type DemoScenario, type PublicCallState } from '@/lib/live-evidence';

const scenarioCopy = {
  reachability: {
    title: 'Reachability check',
    detail: 'Prove CALL-E can reach the phone and ground one exact phrase.',
  },
  claim_evidence: {
    title: 'Claim evidence workflow',
    detail: 'Role-play a payer using fixed fictional data, then inspect every witness.',
  },
  ivr_route: {
    title: 'IVR route replay',
    detail: 'Read a fictional phone menu aloud. Kol replays the saved route by keypad, then checks the keys you heard.',
  },
} as const;

export default function CallTestPage() {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [scenario, setScenario] = useState<DemoScenario>('claim_evidence');
  const [confirmed, setConfirmed] = useState(false);
  const [call, setCall] = useState<PublicCallState | null>(null);
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

  useEffect(() => {
    if (call?.terminal) window.sessionStorage.setItem('kol-live-receipt', JSON.stringify(call));
  }, [call]);

  async function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin, confirmed, scenario }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Call request failed.');
      setCall(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Call request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  function exportReceipt() {
    if (!call) return;
    const blob = new Blob([JSON.stringify(call, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kol-live-receipt-${call.callId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#f7f7f2] px-5 py-8 text-[#102f2a] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[#5f726e]"><ArrowLeft className="size-4" /> Back to Kol</Link>
          <Link href="/console" className="text-sm font-semibold text-emerald-800">Evidence console</Link>
        </div>
        <div className="mt-8 rounded-[2rem] border border-emerald-950/10 bg-white p-6 shadow-xl shadow-emerald-950/5 sm:p-10">
          <span className="grid size-12 place-items-center rounded-2xl bg-[#153f37] text-white"><PhoneCall className="size-5" /></span>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[.14em] text-emerald-700">Controlled live evidence lab</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-.05em]">From real call to auditable verdict.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[#627570]">CALL-E places the call and returns a transcript plus structured result. Kol independently grounds each claim in recipient-side words and refuses to invent a missing route witness.</p>

          {!call ? (
            <form onSubmit={submit} className="mt-9 space-y-6">
              <fieldset>
                <legend className="text-sm font-semibold">Choose a safe demonstration</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  {(Object.keys(scenarioCopy) as DemoScenario[]).map((value) => (
                    <button type="button" key={value} onClick={() => setScenario(value)} className={`rounded-2xl border p-4 text-left transition ${scenario === value ? 'border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700' : 'border-emerald-950/10 bg-[#fbfcf9]'}`}>
                      <span className="flex items-center gap-2 text-sm font-semibold">{value === 'claim_evidence' ? <FileCheck2 className="size-4" /> : value === 'ivr_route' ? <KeyRound className="size-4" /> : <PhoneCall className="size-4" />}{scenarioCopy[value].title}</span>
                      <span className="mt-1 block text-xs leading-5 text-[#6e7e7a]">{scenarioCopy[value].detail}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              {scenario === 'claim_evidence' && <RolePlayScript />}
              {scenario === 'ivr_route' && <MenuScript />}

              <label className="block"><span className="text-sm font-semibold">Authorised recipient number</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 00000 00000" autoComplete="tel" className="mt-2 h-12 w-full rounded-xl border border-emerald-950/15 bg-[#fbfcf9] px-4 outline-none focus:ring-2 focus:ring-emerald-700/20" /></label>
              <label className="block"><span className="text-sm font-semibold">Demo PIN</span><input value={pin} onChange={(event) => setPin(event.target.value)} type="password" autoComplete="one-time-code" className="mt-2 h-12 w-full rounded-xl border border-emerald-950/15 bg-[#fbfcf9] px-4 outline-none focus:ring-2 focus:ring-emerald-700/20" /></label>
              <label className="flex cursor-pointer gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4" /><span>I own or am authorised to receive a call at this exact number. I understand a submitted call may cost money and cannot be cancelled through this interface.</span></label>
              {error && <ErrorMessage message={error} />}
              <button disabled={!confirmed || submitting} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#153f37] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"><PhoneCall className="size-4" />{submitting ? 'Submitting once…' : 'Place one test call'}</button>
            </form>
          ) : <CallReceipt call={call} error={error} exportReceipt={exportReceipt} reset={() => { setCall(null); setConfirmed(false); setError(''); }} attachReceipt={(keys) => setCall(applyRouteReceipt(call, keys))} />}

          <div className="mt-8 grid gap-3 sm:grid-cols-2"><Guard icon={ShieldCheck} title="Allowlist protected" text="Even with the PIN, the server calls only pre-approved test destinations." /><Guard icon={Clock3} title="Duplicate resistant" text="Repeated submissions for one scenario in the same hour reuse one CALL-E idempotency key." /></div>
        </div>
      </div>
    </main>
  );
}

function RolePlayScript() {
  return <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950"><p className="text-sm font-semibold">Keep this fictional payer script beside your phone</p><p className="mt-2 text-xs leading-5">When CALL-E asks, say these two sentences naturally:</p><ol className="mt-3 space-y-2 text-sm"><li><strong>1.</strong> “This is the {CLAIM_DEMO.department}.”</li><li><strong>2.</strong> “Claim {CLAIM_DEMO.reference} was {CLAIM_DEMO.status} {CLAIM_DEMO.amount} on {CLAIM_DEMO.paymentDate}.”</li></ol><p className="mt-3 text-xs text-sky-800">All values are fictional. Do not add a name, member ID, birth date, or medical information.</p></div>;
}

function MenuScript() {
  return <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950"><p className="text-sm font-semibold">You are the phone menu. Keep this beside your phone.</p><p className="mt-2 text-xs leading-5">Kol has told CALL-E the route in advance: press {ROUTE_DEMO.keys.join(', then ')}. Read each menu, then stop and listen for a keypad tone. Note which key you hear; you will enter it afterwards.</p><ol className="mt-3 space-y-2 text-sm"><li><strong>Menu 1.</strong> “{ROUTE_DEMO.menus[0]}”</li><li><strong>Menu 2.</strong> “{ROUTE_DEMO.menus[1]}”</li><li><strong>Then, as the representative:</strong> “This is the {CLAIM_DEMO.department}. Claim {CLAIM_DEMO.reference} was {CLAIM_DEMO.status} {CLAIM_DEMO.amount} on {CLAIM_DEMO.paymentDate}.”</li></ol><p className="mt-3 text-xs text-sky-800">If you hear a spoken number instead of a tone, that is a finding too: enter nothing, and the route stays unverified.</p></div>;
}

function RouteReceiptForm({ call, attachReceipt }: { call: PublicCallState; attachReceipt: (keys: string) => void }) {
  const [keys, setKeys] = useState('');
  if (call.scenario !== 'ivr_route' || !call.terminal || call.status !== 'completed') return null;
  return <section className="rounded-3xl border border-sky-200 bg-sky-50 p-5 text-sky-950">
    <p className="text-sm font-semibold">Independent route receipt</p>
    <p className="mt-1 text-xs leading-5">CALL-E reports pressing <strong>{call.reportedRoute?.length ? call.reportedRoute.join(' then ') : 'nothing'}</strong>. That is the model describing itself. Which keypad tones did you actually hear?</p>
    {call.routeReceipt
      ? <p className="mt-3 text-xs leading-5">Operator-attested receipt recorded: <strong>{call.routeReceipt.keys.join(' then ') || 'no keys heard'}</strong>. {call.routeReceipt.note}</p>
      : <form className="mt-3 flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); attachReceipt(keys); }}>
          <input value={keys} onChange={(event) => setKeys(event.target.value)} placeholder="e.g. 2 1" inputMode="numeric" className="h-11 flex-1 rounded-xl border border-sky-300 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-sky-700/20" />
          <button className="inline-flex h-11 items-center gap-2 rounded-xl bg-sky-900 px-4 text-sm font-semibold text-white"><KeyRound className="size-4" />Attach what I heard</button>
        </form>}
  </section>;
}

function CallReceipt({ call, error, exportReceipt, reset, attachReceipt }: { call: PublicCallState; error: string; exportReceipt: () => void; reset: () => void; attachReceipt: (keys: string) => void }) {
  const tone = call.verdict === 'verified' ? 'emerald' : call.verdict === 'contradicted' || call.verdict === 'unreachable' ? 'rose' : 'amber';
  return <div className="mt-9 space-y-5">
    <section className={`rounded-3xl border p-6 ${tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : tone === 'rose' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-start gap-4">{call.terminal ? <CheckCircle2 className="mt-1 size-6" /> : <Clock3 className="mt-1 size-6 animate-pulse" />}<div className="min-w-0 flex-1"><p className="text-lg font-semibold">{call.terminal ? `Verdict: ${call.verdict.replace('_', ' ')}` : 'CALL-E is working'}</p><p className="mt-1 text-sm">Status: {call.status} · transcript turns: {call.transcriptTurns}</p>{call.terminal && <p className="mt-3 text-sm leading-6">{call.summary}</p>}</div></div>
      {call.terminal && <div className="mt-5 flex flex-wrap gap-4 border-t border-current/10 pt-5"><Link href="/console?view=live" className="text-sm font-semibold">Open in evidence console</Link><button onClick={exportReceipt} className="inline-flex items-center gap-2 text-sm font-semibold"><ArrowDownToLine className="size-4" /> Export receipt</button><button onClick={reset} className="text-sm font-semibold">Start a new authorised test</button></div>}
    </section>
    <RouteReceiptForm call={call} attachReceipt={attachReceipt} />
    {call.extracted && <section className="rounded-3xl border border-emerald-950/10 p-5"><p className="text-sm font-semibold">CALL-E structured result</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.entries(call.extracted).map(([label, value]) => <div key={label} className="rounded-xl bg-[#f3f6f2] p-3"><p className="text-[10px] uppercase tracking-wide text-[#6e7e7a]">{label}</p><p className="mt-1 break-words text-xs font-semibold">{value || 'unsupported'}</p></div>)}</div></section>}
    {call.checks.length > 0 && <section className="rounded-3xl border border-emerald-950/10 p-5"><p className="text-sm font-semibold">Deterministic witness gate</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{call.checks.map((item) => <div key={item.label} className="flex gap-3 rounded-xl bg-[#f7f8f5] p-3"><span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${item.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{item.passed ? <Check className="size-3.5" /> : <X className="size-3.5" />}</span><div><p className="text-xs font-semibold">{item.label}</p><p className="mt-1 text-[11px] leading-4 text-[#6e7e7a]">{item.detail}</p></div></div>)}</div></section>}
    {call.transcript.length > 0 && <section className="rounded-3xl border border-emerald-950/10 p-5"><p className="text-sm font-semibold">Live transcript evidence</p><p className="mt-1 text-xs text-[#6e7e7a]">Untrusted CALL-E output, separated by speaker.</p><div className="mt-4 space-y-2">{call.transcript.map((turn, index) => <div key={`${turn.offsetSeconds}-${index}`} className={`grid grid-cols-[42px_64px_1fr] gap-2 rounded-xl border p-3 text-xs ${turn.speaker === 'Recipient' ? 'border-emerald-200 bg-emerald-50/60' : 'bg-[#f7f8f5]'}`}><span className="font-mono text-[10px] text-[#6e7e7a]">{formatTime(turn.offsetSeconds)}</span><strong>{turn.speaker}</strong><span className="leading-5">{turn.text}</span></div>)}</div></section>}
    {call.failureCode && <ErrorMessage message={`CALL-E failure: ${call.failureCode}`} />}{error && <ErrorMessage message={error} />}
  </div>;
}

function Guard({ icon: Icon, title, text }: { icon: typeof ShieldCheck; title: string; text: string }) {
  return <div className="rounded-2xl border border-emerald-950/10 p-4"><Icon className="size-4 text-emerald-700" /><p className="mt-2 text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-[#6e7e7a]">{text}</p></div>;
}

function ErrorMessage({ message }: { message: string }) {
  return <p className="flex items-center gap-2 text-sm font-medium text-rose-700"><TriangleAlert className="size-4" />{message}</p>;
}

function formatTime(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
}
