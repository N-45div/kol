'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronRight,
  CircleDot, Clock3, FileCheck2, FlaskConical, Headphones, Info, Map, PhoneCall,
  Play, Route, ShieldCheck, Sparkles, TriangleAlert, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { claims, evaluationFamilies, type ClaimState, type DemoClaim } from './demo-data';
import type { PublicCallState } from '@/lib/live-evidence';

type View = 'claims' | 'evidence' | 'live' | 'atlas' | 'methodology';

const nav: { id: View; label: string; icon: typeof FileCheck2 }[] = [
  { id: 'claims', label: 'Claim chases', icon: FileCheck2 },
  { id: 'evidence', label: 'Evidence lab', icon: Headphones },
  { id: 'live', label: 'Live receipt', icon: PhoneCall },
  { id: 'atlas', label: 'Route atlas', icon: Map },
  { id: 'methodology', label: 'Methodology', icon: FlaskConical },
];

const stateStyle: Record<ClaimState, string> = {
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  review: 'border-amber-200 bg-amber-50 text-amber-800',
  contradicted: 'border-rose-200 bg-rose-50 text-rose-800',
  queued: 'border-slate-200 bg-slate-50 text-slate-600',
};

export default function KolApp() {
  const [view, setView] = useState<View>('claims');
  const [selectedId, setSelectedId] = useState('CLM-4471');
  const [filter, setFilter] = useState<'all' | ClaimState>('all');
  const [notice, setNotice] = useState('');
  const [liveReceipt, setLiveReceipt] = useState<PublicCallState | null>(null);
  const selected = claims.find((claim) => claim.id === selectedId) ?? claims[0]!;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const raw = window.sessionStorage.getItem('kol-live-receipt');
      if (raw) {
        try { setLiveReceipt(JSON.parse(raw) as PublicCallState); } catch { window.sessionStorage.removeItem('kol-live-receipt'); }
      }
      if (new URLSearchParams(window.location.search).get('view') === 'live') setView('live');
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function runReplay() {
    setSelectedId('CLM-4471');
    setView('evidence');
    setNotice('Fixture replay completed. No phone call was placed.');
  }

  function exportReceipt() {
    const receipt = { demo: true, phoneCallPlaced: false, claim: selected, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `kol-${selected.id.toLowerCase()}-receipt.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Masked fixture receipt exported.');
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Header runReplay={runReplay} />
      <div className="mx-auto grid max-w-[1560px] md:grid-cols-[224px_minmax(0,1fr)]">
        <Sidebar view={view} setView={setView} />
        <section className="min-w-0 px-4 py-6 sm:px-7 lg:px-9">
          {notice && <output className="mb-4 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" />{notice}</span><button className="text-xs font-semibold" onClick={() => setNotice('')}>Dismiss</button></output>}
          {view === 'claims' && <ClaimsView selected={selected} setSelectedId={setSelectedId} filter={filter} setFilter={setFilter} openEvidence={() => setView('evidence')} />}
          {view === 'evidence' && <EvidenceView selected={selected} setSelectedId={setSelectedId} exportReceipt={exportReceipt} />}
          {view === 'live' && <LiveReceiptView receipt={liveReceipt} />}
          {view === 'atlas' && <AtlasView />}
          {view === 'methodology' && <MethodologyView />}
        </section>
      </div>
    </main>
  );
}

function LiveReceiptView({ receipt }: { receipt: PublicCallState | null }) {
  if (!receipt) return <><PageIntro eyebrow="Observed CALL-E result" title="No live receipt in this browser session." description="Complete an authorised call to bring its sanitised transcript and witness verdict into this console." action={<Link href="/call" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">Run live demo</Link>} /><Card className="mt-5 border-0 shadow-sm"><CardContent className="py-12 text-center text-sm text-muted-foreground">Fixture evidence remains available in Evidence lab. Live transcripts are kept only in the current browser session.</CardContent></Card></>;
  const tone = receipt.verdict === 'verified' ? 'bg-emerald-950' : receipt.verdict === 'contradicted' || receipt.verdict === 'unreachable' ? 'bg-rose-950' : 'bg-amber-950';
  return <><PageIntro eyebrow="Observed CALL-E result" title="One call. Every witness exposed." description="This is the sanitised receipt returned by the real CALL-E call, not a fixture." action={<Badge className={`${tone} text-white`}>{receipt.verdict.replace('_', ' ')}</Badge>} /><div className="grid gap-4 py-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,.9fr)]"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><CardTitle>Live transcript</CardTitle><p className="text-xs text-muted-foreground">{receipt.transcriptTurns} turns · CALL-E status {receipt.status}</p></CardHeader><CardContent className="space-y-2 py-5">{receipt.transcript.map((turn, index) => <div key={`${turn.offsetSeconds}-${index}`} className={`grid grid-cols-[42px_64px_1fr] gap-2 rounded-xl border p-3 text-xs ${turn.speaker === 'Recipient' ? 'border-emerald-200 bg-emerald-50/60' : 'bg-muted/25'}`}><span className="font-mono text-[10px] text-muted-foreground">{Math.round(turn.offsetSeconds)}s</span><strong>{turn.speaker}</strong><span className="leading-5">{turn.text}</span></div>)}</CardContent></Card><div className="space-y-4"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><CardTitle>Live witness gate</CardTitle></CardHeader><CardContent className="space-y-2 py-4">{receipt.checks.map((item) => <div key={item.label} className="flex gap-3 rounded-xl border p-3"><span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${item.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{item.passed ? <Check className="size-3.5" /> : <XCircle className="size-3.5" />}</span><div><p className="text-xs font-semibold">{item.label}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.detail}</p></div></div>)}</CardContent></Card><Card className={`${tone} border-0 text-white shadow-sm`}><CardContent><p className="text-[10px] font-semibold uppercase tracking-[.14em] opacity-70">Final disposition</p><p className="mt-2 text-2xl font-semibold capitalize">{receipt.verdict.replace('_', ' ')}</p><p className="mt-2 text-xs leading-5 opacity-80">{receipt.summary}</p></CardContent></Card></div></div></>;
}

function Header({ runReplay }: { runReplay: () => void }) {
  return <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-[1560px] items-center justify-between px-4 sm:px-7"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"><PhoneCall className="size-4" /></span><div><p className="font-semibold tracking-[-.03em]">Kol</p><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Verified payer calls</p></div></div><div className="flex items-center gap-2"><Badge variant="outline" className="hidden border-emerald-200 bg-emerald-50 text-emerald-800 sm:inline-flex"><span className="size-1.5 rounded-full bg-emerald-500" />Replay lab · zero calls</Badge><Button onClick={runReplay} className="rounded-xl px-3 sm:px-4"><Play />Run safe replay</Button></div></div></header>;
}

function Sidebar({ view, setView }: { view: View; setView: (view: View) => void }) {
  return <><aside className="hidden min-h-[calc(100vh-64px)] border-r border-border/80 px-4 py-6 md:block"><nav aria-label="Product"><p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-muted-foreground">Workspace</p><div className="space-y-1">{nav.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${view === id ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="size-4" />{label}</button>)}</div></nav><div className="mt-9 rounded-2xl border border-emerald-900/10 bg-secondary/55 p-4"><ShieldCheck className="size-5 text-emerald-700" /><p className="mt-3 text-sm font-semibold">Fail-closed by design</p><p className="mt-1 text-xs leading-5 text-muted-foreground">No result enters a financial record until every required witness agrees.</p></div><p className="mt-4 px-2 text-[10px] leading-4 text-muted-foreground">Fictional claims only. This public experience cannot dial or write to an EHR.</p></aside><nav aria-label="Product" className="mb-1 flex gap-1 overflow-x-auto border-b pb-3 md:hidden">{nav.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setView(id)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${view===id?'bg-secondary text-secondary-foreground':'text-muted-foreground'}`}><Icon className="size-3.5" />{label}</button>)}</nav></>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-end"><div><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-emerald-700"><Sparkles className="size-3.5" />{eyebrow}</p><h1 className="text-3xl font-semibold tracking-[-.045em] sm:text-4xl">{title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p></div>{action}</div>;
}

function Metric({ value, label, detail, tone = 'default' }: { value: string; label: string; detail: string; tone?: 'default' | 'green' | 'amber' }) {
  return <Card className={`gap-2 border-0 py-4 shadow-sm ${tone === 'green' ? 'bg-[#173c35] text-white' : tone === 'amber' ? 'bg-[#fff8e8]' : ''}`}><CardContent><p className={`text-2xl font-semibold tracking-[-.04em] ${tone === 'green' ? 'text-white' : ''}`}>{value}</p><p className={`mt-1 text-xs font-semibold ${tone === 'green' ? 'text-emerald-100' : ''}`}>{label}</p><p className={`mt-1 text-[11px] ${tone === 'green' ? 'text-emerald-200/80' : 'text-muted-foreground'}`}>{detail}</p></CardContent></Card>;
}

function ClaimsView({ selected, setSelectedId, filter, setFilter, openEvidence }: { selected: DemoClaim; setSelectedId: (id: string) => void; filter: 'all' | ClaimState; setFilter: (filter: 'all' | ClaimState) => void; openEvidence: () => void }) {
  const visible = useMemo(() => claims.filter((claim) => filter === 'all' || claim.state === filter), [filter]);
  return <><PageIntro eyebrow="Revenue cycle command desk" title="Every answer needs a witness." description="Chase payer claims, reuse proven IVR routes, and withhold structured results until the call evidence supports them." action={<div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground"><Clock3 className="size-4 text-emerald-700" />42 staff minutes recovered in fixture</div>} /><div className="grid grid-cols-2 gap-3 py-5 lg:grid-cols-4"><Metric value="4" label="Claims in worklist" detail="Fictional demo queue" /><Metric value="1" label="Auto-accepted" detail="All witnesses agree" tone="green" /><Metric value="2" label="Held safely" detail="Review or contradiction" tone="amber" /><Metric value="285s" label="Replay delta" detail="Synthetic route timing" /></div><div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,.75fr)]"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="flex-row items-center justify-between border-b py-4"><div><CardTitle>Claim worklist</CardTitle><p className="mt-1 text-xs text-muted-foreground">Fictional records · select a row to inspect</p></div><div className="flex items-center gap-1 rounded-lg bg-muted p-1">{(['all','verified','review','contradicted'] as const).map((item)=><button key={item} onClick={()=>setFilter(item)} className={`rounded-md px-2 py-1 text-[10px] font-semibold capitalize ${filter===item?'bg-white text-foreground shadow-sm':'text-muted-foreground'}`}>{item}</button>)}</div></CardHeader><CardContent className="px-0"><div className="grid grid-cols-[1fr_1.25fr_.75fr_.8fr_22px] border-b bg-muted/40 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground"><span>Claim</span><span>Payer</span><span>Amount</span><span>Status</span><span /></div>{visible.map((claim)=><button key={claim.id} onClick={()=>setSelectedId(claim.id)} className={`grid w-full grid-cols-[1fr_1.25fr_.75fr_.8fr_22px] items-center border-b px-5 py-4 text-left text-sm transition-colors hover:bg-muted/40 ${selected.id===claim.id?'bg-secondary/35':''}`}><span className="font-mono text-xs font-semibold">{claim.id}</span><span className="truncate">{claim.payer}</span><span>{claim.amount}</span><Badge variant="outline" className={stateStyle[claim.state]}>{claim.label}</Badge><ChevronRight className="size-4 text-muted-foreground" /></button>)}</CardContent></Card><ClaimSummary claim={selected} openEvidence={openEvidence} /></div></>;
}

function ClaimSummary({ claim, openEvidence }: { claim: DemoClaim; openEvidence: () => void }) {
  const ok = claim.state === 'verified';
  return <Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className={`border-b py-4 ${ok ? 'bg-primary text-primary-foreground' : claim.state === 'contradicted' ? 'bg-rose-950 text-white' : 'bg-amber-950 text-white'}`}><div className="flex items-start justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] opacity-70">Selected result</p><CardTitle className="mt-1 text-lg text-inherit">{claim.id}</CardTitle></div><Badge className={ok?'bg-emerald-300 text-emerald-950':'bg-white/15 text-white'}>{ok?<Check className="size-3" />:<AlertTriangle className="size-3" />}{claim.label}</Badge></div></CardHeader><CardContent className="py-5"><dl className="grid grid-cols-2 gap-4 text-sm"><Fact label="Payer status" value={claim.answer.status} /><Fact label="Amount" value={claim.answer.amount} /><Fact label="Payment date" value={claim.answer.date} /><Fact label="Suggested action" value={claim.answer.action} /></dl><div className="my-5 h-px bg-border" /><p className="text-xs font-semibold">Why Kol decided this</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{claim.reason}</p><Button variant="outline" className="mt-4 w-full rounded-xl" onClick={openEvidence}>Open evidence receipt <ArrowRight /></Button></CardContent></Card>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>; }

function EvidenceView({ selected, setSelectedId, exportReceipt }: { selected: DemoClaim; setSelectedId: (id: string) => void; exportReceipt: () => void }) {
  const checks = evidenceChecks(selected);
  return <><PageIntro eyebrow="Multi-witness verification" title="The agent is never the only witness." description="Kol binds each result to the question asked, the payer's exact words, the department reached, and a route receipt the extraction model cannot rewrite." action={<Button variant="outline" onClick={exportReceipt} className="rounded-xl"><ArrowDownToLine />Export receipt</Button>} /><div className="flex gap-2 overflow-x-auto py-5">{claims.filter(c=>c.state!=='queued').map(c=><button key={c.id} onClick={()=>setSelectedId(c.id)} className={`shrink-0 rounded-xl border px-3 py-2 text-left ${selected.id===c.id?'border-primary bg-secondary/50':'bg-card'}`}><span className="block font-mono text-[11px] font-semibold">{c.id}</span><span className="text-[10px] text-muted-foreground">{c.label}</span></button>)}</div><div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><div className="flex items-center justify-between"><div><CardTitle>Transcript evidence</CardTitle><p className="mt-1 text-xs text-muted-foreground">Untrusted call data · exact fixture turns</p></div><Badge variant="outline">{selected.mode} fixture</Badge></div></CardHeader><CardContent className="space-y-3 py-5">{selected.transcript.length ? selected.transcript.map((turn,i)=><div key={`${turn.time}-${i}`} className={`grid grid-cols-[44px_54px_1fr] gap-3 rounded-xl border p-3 text-sm ${turn.evidence?'border-emerald-200 bg-emerald-50/55':'bg-muted/25'}`}><span className="font-mono text-[10px] text-muted-foreground">{turn.time}</span><span className={`text-xs font-semibold ${turn.speaker==='Kol'?'text-sky-700':'text-emerald-800'}`}>{turn.speaker}</span><span className="leading-5">{turn.text}</span></div>):<p className="py-12 text-center text-sm text-muted-foreground">This fixture has not run.</p>}</CardContent></Card><div className="space-y-4"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><CardTitle>Witness gate</CardTitle></CardHeader><CardContent className="space-y-2 py-4">{checks.map(check=><div key={check.label} className="flex items-start gap-3 rounded-xl border bg-card p-3"><span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${check.ok?'bg-emerald-100 text-emerald-700':'bg-rose-100 text-rose-700'}`}>{check.ok?<Check className="size-3.5" />:<XCircle className="size-3.5" />}</span><div><p className="text-xs font-semibold">{check.label}</p><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{check.detail}</p></div></div>)}</CardContent></Card><Card className={`gap-2 border-0 py-4 shadow-sm ${selected.state==='verified'?'bg-[#173c35] text-white':selected.state==='contradicted'?'bg-rose-950 text-white':'bg-amber-950 text-white'}`}><CardContent><p className="text-[10px] font-semibold uppercase tracking-[.15em] opacity-70">Final disposition</p><p className="mt-2 text-2xl font-semibold tracking-[-.04em]">{selected.label}</p><p className="mt-2 text-xs leading-5 opacity-80">{selected.reason}</p></CardContent></Card></div></div></>;
}

function evidenceChecks(claim: DemoClaim) {
  return [
    { label: 'Question witness', ok: claim.transcript.some(t=>t.speaker==='Kol'&&t.evidence), detail: 'Claim-specific question appears in the caller transcript.' },
    { label: 'Answer witness', ok: claim.transcript.some(t=>t.speaker==='Payer'&&t.evidence), detail: 'Status and financial fields occur in payer-side words.' },
    { label: 'Destination witness', ok: claim.destination.toLowerCase().includes('claims'), detail: claim.destination },
    { label: 'Independent route receipt', ok: Boolean(claim.routeReceipt), detail: claim.routeReceipt ? `Fixture log: ${claim.routeReceipt.join(' → ')}` : 'No independent receipt supplied.' },
    { label: 'Route agreement', ok: Boolean(claim.routeReceipt)&&claim.route.join('|')===claim.routeReceipt?.join('|'), detail: `Model report: ${claim.route.join(' → ')}` },
  ];
}

function AtlasView() {
  return <><PageIntro eyebrow="Versioned route memory" title="Remember the tree. Distrust the shortcut." description="A route is replayed only while evidence keeps it fresh. Menu rewording is ignored; moved keys and changed depth are dangerous drift." action={<Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800"><CircleDot />2 confirmed routes</Badge>} /><div className="grid gap-4 py-5 xl:grid-cols-[1fr_.8fr]"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><div className="flex items-center justify-between"><div><CardTitle>Northstar Health · Claim status</CardTitle><p className="mt-1 text-xs text-muted-foreground">Masked line +1•••••••0123 · route v2</p></div><Badge className="bg-emerald-100 text-emerald-800">Fresh · 4 confirmations</Badge></div></CardHeader><CardContent className="py-6"><div className="relative space-y-5 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-emerald-200">{[['1','Main menu','Press 2','Claims'],['2','Claims menu','Press 1','Existing claim status'],['3','Queue','Wait','Claims representative']].map(([n,title,action,target])=><div key={n} className="relative grid grid-cols-[36px_1fr_auto] items-center gap-3"><span className="z-10 grid size-9 place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800">{n}</span><div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-muted-foreground">{target}</p></div><Badge variant="outline">{action}</Badge></div>)}</div><div className="mt-7 grid grid-cols-3 gap-3 border-t pt-5"><Fact label="Explore p50" value="380s" /><Fact label="Replay p50" value="95s" /><Fact label="Observed delta" value="−285s" /></div></CardContent></Card><div className="space-y-4"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><CardTitle>Drift laboratory</CardTitle></CardHeader><CardContent className="py-5"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border bg-muted/30 p-3"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">Stored v1</p><p className="mt-2 text-sm font-semibold">Claims → 2</p></div><div className="rounded-xl border border-rose-200 bg-rose-50 p-3"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-rose-700">Observed</p><p className="mt-2 text-sm font-semibold text-rose-950">Claims → 3</p></div></div><div className="mt-4 flex gap-3 rounded-xl bg-rose-950 p-4 text-white"><TriangleAlert className="mt-0.5 size-5 shrink-0" /><div><p className="text-sm font-semibold">Dangerous remap detected</p><p className="mt-1 text-xs leading-5 text-rose-100/80">The route is quarantined before it can teach the atlas. The next chase explores from scratch.</p></div></div></CardContent></Card><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><CardTitle>Learning rule</CardTitle></CardHeader><CardContent className="py-5"><div className="flex items-center gap-2 text-sm"><Route className="size-4 text-emerald-700" /><strong>Verified call</strong><ArrowRight className="size-4 text-muted-foreground" /><span>route learns</span></div><div className="mt-3 flex items-center gap-2 text-sm"><AlertTriangle className="size-4 text-rose-700" /><strong>Contradiction</strong><ArrowRight className="size-4 text-muted-foreground" /><span>route quarantines</span></div></CardContent></Card></div></div></>;
}

function MethodologyView() {
  return <><PageIntro eyebrow="Measured, not implied" title="640 cases. Zero unsafe auto-accepts." description="The evaluation is regenerated from code across eight seeded failure families. It measures Kol's deterministic gate—not CALL-E accuracy or real payer behavior." action={<Badge className="bg-[#173c35] text-white"><ShieldCheck />480 / 480 unsafe held</Badge>} /><div className="grid gap-4 py-5 lg:grid-cols-[1.1fr_.9fr]"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><CardTitle>Adversarial matrix</CardTitle></CardHeader><CardContent className="space-y-4 py-5">{evaluationFamilies.map(([label,value,score])=><div key={label}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-semibold">{label}</span><span className="text-muted-foreground">{value}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-600" style={{width:`${score}%`}} /></div></div>)}</CardContent></Card><div className="space-y-4"><Card className="gap-0 border-0 py-0 shadow-sm"><CardHeader className="border-b py-4"><CardTitle>Claim boundary</CardTitle></CardHeader><CardContent className="space-y-4 py-5"><Boundary icon={CheckCircle2} tone="green" title="Observed" text="Core tests, synthetic gate metrics, CALL-E hotline reachability and transcript capture." /><Boundary icon={FlaskConical} tone="blue" title="Synthetic" text="All payer names, claims, amounts, transcripts and route receipts in this UI." /><Boundary icon={Info} tone="amber" title="Inferred" text="How often RCM teams currently catch wrong AI caller answers; an operator interview is still required." /></CardContent></Card><Card className="gap-2 border-0 bg-[#173c35] py-5 text-white shadow-sm"><CardContent><p className="text-[10px] font-semibold uppercase tracking-[.15em] text-emerald-200">Product thesis</p><p className="mt-2 text-lg font-semibold leading-7">Phone work is being automated. Kol makes the answer auditable.</p><p className="mt-2 text-xs leading-5 text-emerald-100/75">Route memory makes that audit cheaper; it is not presented as the entire problem.</p></CardContent></Card></div></div></>;
}

function Boundary({ icon: Icon, tone, title, text }: { icon: typeof Info; tone: 'green' | 'blue' | 'amber'; title: string; text: string }) {
  const styles={green:'bg-emerald-100 text-emerald-700',blue:'bg-sky-100 text-sky-700',amber:'bg-amber-100 text-amber-700'};
  return <div className="flex gap-3"><span className={`grid size-8 shrink-0 place-items-center rounded-lg ${styles[tone]}`}><Icon className="size-4" /></span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div>;
}
