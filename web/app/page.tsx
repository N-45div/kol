import Link from 'next/link';
import {
  ArrowRight, CheckCircle2, Clock3, FileCheck2, Headphones,
  Map, PhoneCall, Route, ShieldCheck, TriangleAlert,
} from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f7f2] text-[#102f2a]">
      <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3 font-semibold tracking-[-.03em]">
          <span className="grid size-10 place-items-center rounded-2xl bg-[#153f37] text-white"><PhoneCall className="size-4" /></span>
          <span>Kol</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/console" className="hidden rounded-xl px-4 py-2 text-sm font-semibold hover:bg-white sm:block">Open console</Link>
          <Link href="/call" className="rounded-xl bg-[#153f37] px-4 py-2.5 text-sm font-semibold text-white shadow-sm">Test a call</Link>
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-24 pt-16 sm:px-8 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:pt-24">
        <div className="relative z-10">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-900/10 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[.12em] text-emerald-800">
            <ShieldCheck className="size-3.5" /> Evidence before automation
          </p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[.98] tracking-[-.065em] sm:text-6xl lg:text-7xl">
            A payer answer you can actually defend.
          </h1>
          <p className="mt-7 max-w-2xl text-base leading-7 text-[#4f6762] sm:text-lg">
            Kol uses CALL-E to chase claim status, remembers the phone-tree route, and blocks every result that cannot prove what was asked, who answered, what they said, and how the call got there.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/console" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#153f37] px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-950/10">Explore the evidence console <ArrowRight className="size-4" /></Link>
            <Link href="/call" className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-900/15 bg-white px-5 py-3.5 text-sm font-semibold">Place an authorised test call <PhoneCall className="size-4" /></Link>
          </div>
          <p className="mt-4 text-xs text-[#71817e]">Public demo uses fictional claims. No EHR writes. Live calling is PIN- and destination-gated.</p>
        </div>

        <div className="relative">
          <div className="absolute -inset-16 rounded-full bg-[#d8eee1] blur-3xl" />
          <div className="relative rounded-[2rem] border border-emerald-950/10 bg-white p-5 shadow-2xl shadow-emerald-950/10 sm:p-7">
            <div className="flex items-center justify-between border-b pb-5">
              <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#78908b]">Claim CLM-4471</p><p className="mt-1 text-xl font-semibold">$1,240 paid · Aug 12, 2026</p></div>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">Verified</span>
            </div>
            <div className="mt-6 space-y-3">
              {[
                ['Question witness', 'Claim-specific question found', CheckCircle2],
                ['Destination witness', 'Claims status department', CheckCircle2],
                ['Answer witness', 'Amount and full date grounded', CheckCircle2],
                ['Route witness', 'Fixture receipt: 2 → 1', CheckCircle2],
              ].map(([label, detail, Icon]) => (
                <div key={String(label)} className="flex items-center gap-3 rounded-2xl bg-[#f6f8f5] p-4">
                  <span className="grid size-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><Icon className="size-4" /></span>
                  <div><p className="text-sm font-semibold">{label as string}</p><p className="mt-0.5 text-xs text-[#71817e]">{detail as string}</p></div>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl bg-[#153f37] p-5 text-white">
              <p className="text-xs uppercase tracking-[.13em] text-emerald-200">Decision</p>
              <p className="mt-2 text-sm font-medium">All independent witnesses agree. Safe for a biller to review.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-emerald-950/10 bg-white">
        <div className="mx-auto grid max-w-7xl divide-y px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8">
          {[
            ['25 min', 'Manual claim-status inquiry', 'CAQH 2024 Index'],
            ['$11B', 'Annual medical claim-status spend', 'CAQH 2024 Index'],
            ['2,000', 'Deterministic adversarial verdicts', '720 single-claim · 1,280 multi-claim'],
          ].map(([value, label, source]) => <div key={value} className="py-8 sm:px-8 sm:first:pl-0"><p className="text-3xl font-semibold tracking-[-.05em]">{value}</p><p className="mt-1 text-sm font-medium">{label}</p><p className="mt-1 text-xs text-[#71817e]">{source}</p></div>)}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="max-w-3xl"><p className="text-xs font-semibold uppercase tracking-[.14em] text-emerald-700">Not another voice bot</p><h2 className="mt-3 text-4xl font-semibold tracking-[-.05em]">The call is not the record. The evidence is.</h2><p className="mt-4 leading-7 text-[#5f726e]">A correctly shaped answer can still be wrong. Kol turns each field into a claim that must survive independent checks before it moves downstream.</p></div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            [Headphones, 'Hear the question', 'The transcript must show the exact claim-specific question. A plausible answer to an unasked question is held.'],
            [FileCheck2, 'Ground every field', 'Status, amount, full date, denial code, and department each need payer-side evidence.'],
            [Route, 'Prove the route', 'Model-reported keys must agree with a fixture log, decoded DTMF audio, or independent provider event.'],
          ].map(([Icon, title, copy]) => <article key={String(title)} className="rounded-3xl border border-emerald-950/10 bg-white p-6"><span className="grid size-11 place-items-center rounded-2xl bg-[#eaf4ed] text-emerald-800"><Icon className="size-5" /></span><h3 className="mt-6 text-lg font-semibold">{title as string}</h3><p className="mt-2 text-sm leading-6 text-[#667974]">{copy as string}</p></article>)}
        </div>
      </section>

      <section className="bg-[#102f2a] text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-2 lg:items-center">
          <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-emerald-300">Route Atlas</p><h2 className="mt-3 text-4xl font-semibold tracking-[-.05em]">Remember the path. Distrust the shortcut.</h2><p className="mt-4 max-w-xl leading-7 text-emerald-100/70">Kol replays a reviewed IVR route only while the live prompts still match. Drift quarantines the map and forces exploration next time.</p></div>
          <div className="space-y-3">
            {[[Map, 'Versioned payer routes', 'Every correction creates a new, inspectable route version.'], [TriangleAlert, 'Fail-closed drift', 'A remapped key never silently teaches the atlas.'], [Clock3, 'Measured time, honest scope', 'Exploration and replay timings stay separate; no invented savings.']].map(([Icon, title, copy]) => <div key={String(title)} className="flex gap-4 rounded-2xl border border-white/10 bg-white/5 p-5"><Icon className="mt-0.5 size-5 text-emerald-300" /><div><p className="font-semibold">{title as string}</p><p className="mt-1 text-sm leading-6 text-emerald-100/65">{copy as string}</p></div></div>)}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 py-24 text-center sm:px-8">
        <h2 className="text-4xl font-semibold tracking-[-.05em]">See the difference between completed and verified.</h2>
        <p className="mx-auto mt-4 max-w-2xl leading-7 text-[#60736f]">Replay the fictional evidence lab, inspect route drift, then place one controlled test call when you are ready.</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Link href="/console" className="rounded-xl bg-[#153f37] px-5 py-3.5 text-sm font-semibold text-white">Open console</Link><Link href="/call" className="rounded-xl border border-emerald-900/15 bg-white px-5 py-3.5 text-sm font-semibold">Test live calling</Link></div>
      </section>

      <footer className="border-t border-emerald-950/10 px-5 py-8 text-xs text-[#71817e]"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 sm:flex-row sm:px-3"><p>Kol · Healthcare RCM evidence infrastructure</p><p>Hackathon prototype · Fictional data only · Not a HIPAA compliance claim</p></div></footer>
    </main>
  );
}
