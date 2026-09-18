"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";
import { Check, FileText, LockKeyhole, ShieldCheck, Upload, X } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type Subscription = { merchant: string; amount: number; date: string; cadence: string; confidence: number; source: string; accountEmail?: string; accountId?: string; selected: boolean };
type Receipt = { merchant_name: string; status: string; delivery_channel: string; receipt_id: string; document_sha256: string };

function money(amount: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount); }

export default function Home() {
  const [step, setStep] = useState(1);
  const [transactions, setTransactions] = useState<Subscription[]>([]);
  const [notice, setNotice] = useState("Your statement is parsed in memory and cleared after this session.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [textLog, setTextLog] = useState("");
  const signatureRef = useRef<SignatureCanvas>(null);
  const selected = useMemo(() => transactions.filter((item) => item.selected), [transactions]);

  async function parseFile(file: File) {
    if (!file.name.match(/\.(csv|pdf)$/i)) { setError("Please choose a CSV or PDF statement."); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch(`${API_URL}/api/parse-statement`, { method: "POST", body: form });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Statement parsing failed.");
      const result = await response.json();
      setTransactions(result.transactions.map((item: Subscription) => ({ ...item, selected: true })));
      setNotice(`${result.detected_count} recurring charge${result.detected_count === 1 ? "" : "s"} detected. The source file was discarded from this browser session.`);
      setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Statement parsing failed."); }
    finally { setBusy(false); }
  }

  async function parseText() {
    if (!textLog.trim()) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API_URL}/api/parse-text`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: textLog }) });
      if (!response.ok) throw new Error((await response.json()).detail ?? "Transaction parsing failed.");
      const result = await response.json();
      setTransactions(result.transactions.map((item: Subscription) => ({ ...item, selected: true })));
      setTextLog(""); setNotice(`${result.detected_count} recurring charge${result.detected_count === 1 ? "" : "s"} detected from pasted text.`); setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Transaction parsing failed."); }
    finally { setBusy(false); }
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void parseFile(file); }
  function handleFile(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) void parseFile(file); event.target.value = ""; }
  function updateAccount(index: number, key: "accountEmail" | "accountId", value: string) { setTransactions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)); }
  function toggle(index: number) { setTransactions((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, selected: !item.selected } : item)); }

  async function execute() {
    const signature = signatureRef.current?.getTrimmedCanvas().toDataURL("image/png");
    if (!signature || !customerName.trim()) { setError("Add your full legal name and signature before continuing."); return; }
    if (selected.some((item) => !item.accountEmail || !item.accountId)) { setError("Every selected merchant needs an account email and account ID."); setStep(2); return; }
    setBusy(true); setError("");
    try {
      const results: Receipt[] = [];
      for (const item of selected) {
        const response = await fetch(`${API_URL}/api/generate-pdf`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customer_name: customerName, signature_data_url: signature, merchant_name: item.merchant, account_id: item.accountId, account_email: item.accountEmail }) });
        if (!response.ok) throw new Error((await response.json()).detail ?? `Could not prepare ${item.merchant}.`);
        const blob = await response.blob();
        const download = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = download; link.download = `notice-${item.merchant.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`; link.click(); URL.revokeObjectURL(download);
        results.push({ merchant_name: item.merchant, status: "prepared", delivery_channel: "merchant-endpoint-pending", receipt_id: crypto.randomUUID(), document_sha256: "generated-by-api" });
      }
      setReceipts(results); setStep(4); setNotice("Your notices were generated in memory. No merchant endpoint was contacted by this starter deployment.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Cancellation preparation failed."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#f5f7f2] text-[#18312e]">
    <header className="mx-auto flex max-w-6xl items-center justify-between border-b border-[#dce4dc] px-5 py-6 lg:px-10"><div className="flex items-center gap-3 font-extrabold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#18312e] text-xs text-white">SK</span> Subscription Killer <span className="text-[#f06e55]">Proxy</span></div><div className="flex items-center gap-3 text-xs font-medium text-[#70837b]"><span className="hidden items-center gap-2 sm:flex"><LockKeyhole size={15} /> private session</span><span className="grid h-9 w-9 place-items-center rounded-full bg-[#f4d4ca] text-[10px] text-[#8c4e3d]">JD</span></div></header>
    <section className="mx-auto max-w-6xl px-5 pb-10 pt-16 lg:px-10"><div className="mb-5 flex items-center gap-2 font-mono text-[10px] tracking-[.12em] text-[#7b8d86]"><span className="h-2 w-2 rounded-full bg-[#f06e55]" /> PRIVATE CANCELLATION WORKSPACE</div><h1 className="max-w-3xl text-5xl font-extrabold leading-[.98] tracking-[-.05em] sm:text-7xl">Take back your recurring <span className="text-[#f06e55]">spend.</span></h1><p className="mt-6 max-w-xl text-sm leading-7 text-[#6f807b]">Find subscriptions hiding in your statement, choose what goes, and prepare a formal cancellation request. Your financial data stays in this session only.</p></section>
    <section className="mx-auto grid max-w-6xl gap-8 px-5 pb-16 lg:grid-cols-[210px_1fr] lg:px-10"><aside className="flex gap-2 lg:block lg:pt-7">{["Find subscriptions", "Confirm accounts", "Sign & prepare", "Complete"].map((label, index) => <div key={label} className={`mb-5 flex flex-1 items-center gap-3 ${step === index + 1 ? "text-[#18312e]" : "text-[#9daaa4]"}`}><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[10px] ${step >= index + 1 ? "bg-[#18312e] text-white" : "bg-[#e7ebe6]"}`}>0{index + 1}</span><span className="hidden text-xs font-bold sm:block">{label}</span></div>)}<div className="hidden rounded-xl bg-[#d8f0e2] p-4 text-xs text-[#54796a] lg:block"><ShieldCheck className="mb-3 text-[#277c5b]" size={20} /><strong className="block text-[#18312e]">Zero retention</strong><span className="mt-1 block leading-5">Files are processed in memory and destroyed when you leave.</span></div></aside>
      <div className="overflow-hidden rounded-2xl border border-[#dce4dc] bg-[#fffefa] shadow-[0_20px_45px_rgba(34,65,55,.06)]"><div className="flex items-start justify-between border-b border-[#dce4dc] p-6 sm:p-9"><div><span className="font-mono text-[10px] tracking-[.12em] text-[#7b8d86]">{step === 4 ? "SESSION COMPLETE" : `STEP ${step} OF 3`}</span><h2 className="mt-2 text-2xl font-extrabold tracking-[-.04em]">{step === 1 ? "Find recurring charges" : step === 2 ? "Confirm your accounts" : step === 3 ? "Authorize your requests" : "Your notices are ready"}</h2><p className="mt-2 text-xs text-[#6f807b]">{step === 1 ? "Upload a statement or paste transaction logs to begin." : step === 2 ? "Every selected merchant needs an account identifier." : step === 3 ? "Review and sign the limited cancellation authorization." : notice}</p></div><span className="hidden rounded-full border border-[#dce4dc] px-3 py-2 font-mono text-[10px] text-[#70837b] sm:block"><ShieldCheck className="mr-1 inline text-[#277c5b]" size={13} /> ephemeral data</span></div>
        {error && <div className="mx-6 mt-5 flex items-center justify-between rounded-lg bg-[#fff0eb] p-3 text-xs text-[#a24f3d] sm:mx-9"><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
        {step === 1 && <div className="p-6 sm:p-9"><label onDrop={handleDrop} onDragOver={(event) => event.preventDefault()} className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-[#b9d5c6] bg-[#f8fcf9] px-6 py-12 text-center transition hover:bg-[#f1faf4]"><Upload className="mb-4 text-[#277c5b]" size={28} /><strong className="text-sm">Drop your statement here, or choose a file</strong><span className="mt-2 text-xs text-[#70837b]">CSV or PDF · parsed entirely in memory · 10 MB maximum</span><input onChange={handleFile} type="file" accept=".csv,.pdf" className="hidden" /></label><div className="my-5 flex items-center gap-3 text-[10px] font-mono text-[#9aa8a1]"><span className="h-px flex-1 bg-[#dce4dc]" /> OR PASTE TRANSACTIONS <span className="h-px flex-1 bg-[#dce4dc]" /></div><textarea value={textLog} onChange={(event) => setTextLog(event.target.value)} className="min-h-28 w-full resize-y rounded-lg border border-[#dce4dc] bg-white p-3 text-xs outline-[#f06e55]" placeholder="Example: 09/01 Netflix Monthly $15.49" /><button disabled={busy || !textLog.trim()} onClick={() => void parseText()} className="mt-3 rounded-lg bg-[#18312e] px-4 py-3 text-xs font-bold text-white disabled:opacity-40">{busy ? "Parsing..." : "Parse pasted transactions"}</button><p className="mt-6 flex items-center gap-2 text-[11px] text-[#277c5b]"><Check size={15} /> {notice}</p></div>}
        {step === 2 && <div className="p-6 sm:p-9"><div className="mb-5 rounded-lg bg-[#f5faf6] p-4 text-xs">{selected.length} merchants selected <span className="font-bold text-[#277c5b]">· {money(selected.reduce((total, item) => total + item.amount, 0))}/mo estimate</span></div><div className="space-y-3">{transactions.map((item, index) => <div key={`${item.merchant}-${index}`} className={`rounded-xl border p-4 ${item.selected ? "border-[#b9d5c6]" : "border-[#dce4dc]"}`}><div className="flex items-center gap-3"><button onClick={() => toggle(index)} className={`grid h-5 w-5 place-items-center rounded border ${item.selected ? "border-[#277c5b] bg-[#277c5b] text-white" : "border-[#b9c8be]"}`} aria-label={`Select ${item.merchant}`}>{item.selected && <Check size={13} />}</button><FileText size={19} className="text-[#f06e55]" /><div className="min-w-0 flex-1"><strong className="block text-xs">{item.merchant}</strong><span className="text-[10px] text-[#70837b]">{item.cadence} · {money(item.amount)} · {item.confidence}% match</span></div></div>{item.selected && <div className="mt-4 grid gap-3 border-t border-[#e8eee8] pt-4 sm:grid-cols-2"><label className="text-[10px] font-mono uppercase text-[#70837b]">Account email address<input value={item.accountEmail ?? ""} onChange={(event) => updateAccount(index, "accountEmail", event.target.value)} className="mt-1 w-full rounded-md border border-[#cbd8cf] p-2 text-xs outline-[#f06e55]" placeholder="you@example.com" /></label><label className="text-[10px] font-mono uppercase text-[#70837b]">Account ID / contract number<input value={item.accountId ?? ""} onChange={(event) => updateAccount(index, "accountId", event.target.value)} className="mt-1 w-full rounded-md border border-[#cbd8cf] p-2 text-xs outline-[#f06e55]" placeholder="Merchant identifier" /></label></div>}</div>)}</div><div className="mt-6 flex justify-end border-t border-[#dce4dc] pt-5"><button onClick={() => setStep(3)} disabled={!selected.length} className="rounded-lg bg-[#f06e55] px-5 py-3 text-xs font-bold text-white disabled:opacity-40">Continue to signature →</button></div></div>}
        {step === 3 && <div className="p-6 sm:p-9"><div className="rounded-xl bg-[#f5faf6] p-5 text-xs leading-6 text-[#54796a]">I authorize Subscription Killer Proxy as a limited proxy solely to transmit cancellation notices for the {selected.length} selected merchant accounts. This does not grant access to funds, bank credentials, or unrelated accounts.</div><label className="mt-6 block text-[10px] font-mono uppercase text-[#70837b]">Your full legal name<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1 w-full rounded-md border border-[#cbd8cf] p-3 text-xs outline-[#f06e55]" placeholder="Jane Doe" /></label><div className="mt-5 flex items-center justify-between"><span className="text-[10px] font-mono uppercase text-[#70837b]">Draw your signature</span><button onClick={() => signatureRef.current?.clear()} className="text-xs text-[#f06e55]">Clear</button></div><div className="mt-2 overflow-hidden rounded-lg border border-[#cbd8cf] bg-white"><SignatureCanvas ref={signatureRef} penColor="#18312e" canvasProps={{ className: "h-40 w-full" }} /></div><div className="mt-6 flex justify-between border-t border-[#dce4dc] pt-5"><button onClick={() => setStep(2)} className="rounded-lg bg-[#f0f4ef] px-4 py-3 text-xs font-bold">← Back</button><button onClick={() => void execute()} disabled={busy} className="rounded-lg bg-[#f06e55] px-5 py-3 text-xs font-bold text-white disabled:opacity-40">{busy ? "Preparing..." : "Sign & prepare notices →"}</button></div></div>}
        {step === 4 && <div className="p-6 sm:p-9"><div className="mb-7 text-center"><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-[#d8f0e2] text-[#277c5b]"><Check /></div><p className="text-sm font-bold">Generated in memory, ready for delivery</p><p className="mt-2 text-xs leading-6 text-[#70837b]">The PDFs were downloaded locally. Merchant dispatch is intentionally pending until verified endpoints are configured.</p></div><div className="space-y-2">{receipts.map((receipt) => <div key={receipt.receipt_id} className="flex items-center justify-between rounded-lg border border-[#dce4dc] p-4 text-xs"><span className="font-bold">{receipt.merchant_name}</span><span className="font-mono text-[10px] text-[#277c5b]">✓ prepared · endpoint pending</span></div>)}</div><button onClick={() => { setStep(1); setTransactions([]); setReceipts([]); setCustomerName(""); signatureRef.current?.clear(); }} className="mt-7 rounded-lg bg-[#18312e] px-5 py-3 text-xs font-bold text-white">Start a new private session ↗</button></div>}
      </div></section>
    <footer className="mx-auto max-w-6xl border-t border-[#dce4dc] px-5 py-8 text-[10px] leading-5 text-[#70837b] lg:px-10">Privacy Policy & Terms of Service: Subscription Killer Proxy processes uploaded statements, pasted logs, account identifiers, and signatures only for the active cancellation session. We do not sell or retain those records, and the stateless API is designed to process them in memory only. Notices are user-authorized templates; legal effect varies by jurisdiction and merchant policy. Review each notice and choose a verified delivery channel.</footer>
  </main>;
}
