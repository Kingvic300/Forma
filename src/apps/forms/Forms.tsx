import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Link2, Plus, RefreshCw, Share2, Trash2, X } from "lucide-react";
import { askConfirm, errorText, toast } from "../../lib/dialog";
import { getOnlineConfig, newFormId, newOwnerToken, rpc, shareLink, type OnlineConfig, type OnlineForm } from "../../lib/online";
import { OnlineSetup } from "../../OnlineSetup";
import Papa from "papaparse";
import { Linkify } from "../../lib/links";
import { useFile } from "../../lib/useFile";
import { safeName, saveAs } from "../../lib/platform";
import { createFile, uid } from "../../lib/store";
import { go } from "../../lib/route";
import { Modal, Missing, Spinner, TitleBar } from "../../ui";
import { FormView } from "./FormFill";
import { hasOptions, TYPES, type FormData, type Question, type Response } from "./types";

const COLORS = ["#b195f5", "#7c9dff", "#4fbf8b", "#3cc8dc", "#e2b25b", "#f07a80"];

export default function Forms({ id }: { id: string }) {
  const f = useFile<FormData>(id);
  const [tab, setTab] = useState<"edit" | "preview" | "responses">("edit");
  const [focus, setFocus] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const online = useOnline(f.data, f.setData);

  if (f.missing) return <Missing app="forms" />;
  if (!f.data || !f.meta) return <div className="loading">Loading…</div>;
  const form = f.data;
  const color = form.color ?? COLORS[0];

  const set = (patch: Partial<FormData>) => f.setData({ ...form, ...patch });
  const setQ = (qid: string, patch: Partial<Question>) => set({ questions: form.questions.map((q) => (q.id === qid ? { ...q, ...patch } : q)) });
  const addQ = (after?: number) => {
    const q: Question = { id: uid(), type: "choice", label: "", required: false, options: ["Option 1"] };
    const qs = form.questions.slice();
    qs.splice(after === undefined ? qs.length : after + 1, 0, q);
    set({ questions: qs });
    setFocus(q.id);
  };
  const moveQ = (i: number, d: number) => {
    const qs = form.questions.slice();
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    set({ questions: qs });
  };

  const header = form.questions.map((q) => q.label || "Untitled question");
  const rows = form.responses.map((r) => [new Date(r.at).toLocaleString(), ...form.questions.map((q) => [r.answers[q.id] ?? ""].flat().join(", "))]);

  async function exportCSV() {
    await saveAs(`${safeName(form.title)} (Responses).csv`, Papa.unparse([["Timestamp", ...header], ...rows]));
  }
  async function toSheets() {
    const sid = await createFile("sheets", `${form.title} (Responses)`, { sheets: [{ name: "Responses", cells: [["Timestamp", ...header], ...rows] }] });
    go(`/sheets/${sid}`);
  }
  async function exportForm() {
    // Never put the owner code of an online form into a file someone else may get.
    const { responses: _r, online: _o, ...template } = form;
    await saveAs(`${safeName(form.title)}.form.json`, JSON.stringify({ ...template, responses: [] }, null, 2));
  }

  return (
    <div className="app-page forms" style={{ "--form": color } as React.CSSProperties}>
      <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="forms">
        <div className="seg">
          <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>Questions</button>
          <button className={tab === "preview" ? "on" : ""} onClick={() => setTab("preview")}>Fill in</button>
          <button className={tab === "responses" ? "on" : ""} onClick={() => setTab("responses")}>Responses ({form.responses.length})</button>
        </div>
        <button className={form.online ? "on" : ""} onClick={() => setSharing(true)} title={form.online ? "This form has a link people can fill in" : "Get a link anyone can fill in"}>
          {form.online ? <Link2 /> : <Share2 />} {form.online ? "Shared" : "Share"}
        </button>
      </TitleBar>
      {sharing && <ShareDialog form={form} online={online} onClose={() => setSharing(false)} onSaveFile={exportForm} />}
      <div className="form-scroll">
        {tab === "edit" && (
          <div className="form-col">
            <div className="card form-head">
              <input className="form-title" value={form.title} placeholder="Form title" onChange={(e) => { set({ title: e.target.value }); if (f.meta!.name === form.title) f.rename(e.target.value); }} />
              <textarea className="form-desc" value={form.description} placeholder="Form description" rows={2} onChange={(e) => set({ description: e.target.value })} />
              <div className="swatches">
                {COLORS.map((c) => <button key={c} className={c === color ? "on" : ""} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Theme ${c}`} />)}
              </div>
            </div>
            {form.questions.map((q, i) => (
              <div key={q.id} className={"card q" + (focus === q.id ? " focus" : "")} onClick={() => setFocus(q.id)}>
                <div className="q-row">
                  <input className="q-label" value={q.label} placeholder="Question" autoFocus={focus === q.id && !q.label} onChange={(e) => setQ(q.id, { label: e.target.value })} />
                  <select value={q.type} onChange={(e) => {
                    const type = e.target.value as Question["type"];
                    setQ(q.id, { type, options: hasOptions(type) && !q.options.length ? ["Option 1"] : q.options });
                  }}>
                    {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <input className="q-help" value={q.help ?? ""} placeholder="Description (optional)" onChange={(e) => setQ(q.id, { help: e.target.value })} />
                {hasOptions(q.type) ? (
                  <div className="opts">
                    {q.options.map((o, j) => (
                      <div key={j} className="opt">
                        <span className={"mark " + q.type}>{q.type === "dropdown" ? `${j + 1}.` : ""}</span>
                        <input value={o} onChange={(e) => setQ(q.id, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })}
                          onKeyDown={(e) => { if (e.key === "Enter") setQ(q.id, { options: [...q.options, `Option ${q.options.length + 1}`] }); }} />
                        <button className="icon" title="Remove option" onClick={() => setQ(q.id, { options: q.options.filter((_, k) => k !== j) })}><X /></button>
                      </div>
                    ))}
                    <button className="link" onClick={() => setQ(q.id, { options: [...q.options, `Option ${q.options.length + 1}`] })}>+ Add option</button>
                  </div>
                ) : (
                  <div className="q-sample">{TYPES.find(([t]) => t === q.type)![1]}</div>
                )}
                <div className="q-foot">
                  <button className="icon" title="Move up" onClick={() => moveQ(i, -1)}><ArrowUp /></button>
                  <button className="icon" title="Move down" onClick={() => moveQ(i, 1)}><ArrowDown /></button>
                  <button className="icon" title="Duplicate" onClick={() => { const qs = form.questions.slice(); qs.splice(i + 1, 0, { ...q, id: uid() }); set({ questions: qs }); }}><Copy /></button>
                  <button className="icon" title="Delete" onClick={() => set({ questions: form.questions.filter((x) => x.id !== q.id) })}><Trash2 /></button>
                  <span className="sep" />
                  <label className="check">Required <input type="checkbox" checked={q.required} onChange={(e) => setQ(q.id, { required: e.target.checked })} /></label>
                  <button className="icon" title="Add question below" onClick={() => addQ(i)}><Plus /></button>
                </div>
              </div>
            ))}
            <button className="add-q" onClick={() => addQ()}><Plus /> Add question</button>
          </div>
        )}
        {tab === "preview" && (
          <div className="form-col">
            <div className="hint">Fill the form here, or hand this computer to someone. Each submission is saved under Responses.</div>
            <FormView id={id} onSubmit={(r) => f.setData((d) => ({ ...d, responses: [...d.responses, r] }))} />
          </div>
        )}
        {tab === "responses" && (
          <div className="form-col wide">
            {form.online && (
              <div className="sync-line">
                <span>
                  {online.error
                    ? `Couldn’t check for new answers: ${online.error}`
                    : `New answers from your link arrive automatically every 30 seconds.${online.checked ? ` Last checked at ${new Date(online.checked).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : ""}`}
                </span>
                <button onClick={() => online.pull(false)} disabled={online.busy}>
                  {online.busy ? <Spinner /> : <RefreshCw />} Check now
                </button>
              </div>
            )}
            <div className="card resp-head">
              <h2>{form.responses.length} response{form.responses.length === 1 ? "" : "s"}</h2>
              <div className="row">
                <button onClick={toSheets} disabled={!rows.length}>Open in Sheets</button>
                <button onClick={exportCSV} disabled={!rows.length}>Download .csv</button>
                <button onClick={async () => (await askConfirm(`Delete all ${form.responses.length} responses?`, { body: "This can’t be undone. Download them first if you need a copy.", danger: true, confirmLabel: "Delete responses" })) && set({ responses: [] })} disabled={!rows.length}>Delete all</button>
              </div>
            </div>
            {form.questions.map((q) => <Summary key={q.id} q={q} form={form} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ q, form }: { q: Question; form: FormData }) {
  const answers = form.responses.map((r) => r.answers[q.id]).filter((a) => a !== undefined && a !== "" && !(Array.isArray(a) && !a.length));
  const counted = hasOptions(q.type) || q.type === "scale";
  const counts = new Map<string, number>();
  if (counted) {
    const keys = q.type === "scale" ? ["1", "2", "3", "4", "5"] : q.options;
    keys.forEach((o) => counts.set(o, 0));
    answers.flat().forEach((a) => counts.set(a, (counts.get(a) ?? 0) + 1));
  }
  const max = Math.max(1, ...counts.values());
  return (
    <div className="card summary">
      <h3>{q.label || "Untitled question"}</h3>
      <div className="muted">{answers.length} answer{answers.length === 1 ? "" : "s"}</div>
      {counted ? (
        <div className="bars">
          {[...counts].map(([o, n]) => (
            <div key={o} className="bar-row">
              <span className="bar-label">{o}</span>
              <span className="bar"><span style={{ width: `${(100 * n) / max}%` }} /></span>
              <span className="bar-n">{n}{answers.length ? ` (${Math.round((100 * n) / answers.length)}%)` : ""}</span>
            </div>
          ))}
        </div>
      ) : (
        <ul className="answers">
          {answers.slice(-50).reverse().map((a, i) => <li key={i}><Linkify text={[a].flat().join(", ")} /></li>)}
        </ul>
      )}
    </div>
  );
}

type Row = { rid: number; answers: Response["answers"]; created_at: string };

/** Keeps a shared form's online copy up to date and pulls in answers from its link. */
function useOnline(data: FormData | null, setData: (fn: (d: FormData) => FormData) => void) {
  const [cfg, setCfg] = useState<OnlineConfig | null | undefined>(undefined);
  const [checked, setChecked] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const link = data?.online;

  useEffect(() => {
    getOnlineConfig().then((c) => setCfg(c ?? null));
  }, []);

  const pull = useCallback(
    async (quiet = true) => {
      if (!cfg || !link) return;
      setBusy(true);
      try {
        let after = link.lastId;
        let count = 0;
        for (;;) {
          const rows = await rpc<Row[]>(cfg, "forma_responses_since", { p_id: link.id, p_token: link.token, p_after: after });
          if (!rows.length) break;
          after = rows[rows.length - 1].rid;
          count += rows.length;
          setData((d) => {
            const seen = new Set(d.responses.map((r) => r.rid));
            const fresh = rows.filter((r) => !seen.has(r.rid)).map((r) => ({ at: Date.parse(r.created_at), answers: r.answers, rid: r.rid }));
            return { ...d, responses: [...d.responses, ...fresh], online: d.online && { ...d.online, lastId: Math.max(d.online.lastId, after) } };
          });
          if (rows.length < 1000) break;
        }
        setChecked(Date.now());
        setError("");
        if (count) toast(`${count} new response${count === 1 ? "" : "s"}`, "success");
        else if (!quiet) toast("No new responses yet");
      } catch (e) {
        setError(errorText(e));
        if (!quiet) toast(errorText(e), "error");
      } finally {
        setBusy(false);
      }
    },
    [cfg, link?.id, link?.token, link?.lastId],
  );
  const latestPull = useRef(pull);
  latestPull.current = pull;

  useEffect(() => {
    if (!cfg || !link) return;
    latestPull.current();
    const t = setInterval(() => latestPull.current(), 30_000);
    return () => clearInterval(t);
  }, [cfg, link?.id]);

  // Edits to the questions update the online copy shortly after you stop typing.
  const definition = data ? JSON.stringify({ title: data.title, description: data.description, color: data.color, questions: data.questions }) : "";
  useEffect(() => {
    if (!cfg || !link || !definition) return;
    const t = setTimeout(() => {
      rpc(cfg, "forma_publish", { p_id: link.id, p_token: link.token, p_definition: JSON.parse(definition), p_accepting: link.accepting }).catch((e) => setError(errorText(e)));
    }, 1500);
    return () => clearTimeout(t);
  }, [definition, cfg, link?.id, link?.accepting]);

  async function share() {
    if (!cfg || !data) return;
    const o: OnlineForm = { id: newFormId(), token: newOwnerToken(), accepting: true, lastId: 0 };
    await rpc(cfg, "forma_publish", { p_id: o.id, p_token: o.token, p_definition: JSON.parse(definition), p_accepting: true });
    setData((d) => ({ ...d, online: o }));
  }

  async function setAccepting(accepting: boolean) {
    if (!cfg || !link) return;
    await rpc(cfg, "forma_publish", { p_id: link.id, p_token: link.token, p_definition: JSON.parse(definition), p_accepting: accepting });
    setData((d) => ({ ...d, online: d.online && { ...d.online, accepting } }));
  }

  async function stop() {
    if (!cfg || !link) return;
    await pull(true);
    await rpc(cfg, "forma_unpublish", { p_id: link.id, p_token: link.token });
    setData((d) => {
      const { online: _o, ...rest } = d;
      return rest;
    });
  }

  return { cfg, setCfg, checked, error, busy, pull, share, setAccepting, stop };
}

function ShareDialog({ form, online, onClose, onSaveFile }: { form: FormData; online: ReturnType<typeof useOnline>; onClose: () => void; onSaveFile: () => void }) {
  const [setup, setSetup] = useState(false);
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = form.online && online.cfg ? shareLink(online.cfg, form.online.id) : "";

  const run = async (job: () => Promise<void>) => {
    setWorking(true);
    try {
      await job();
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setWorking(false);
    }
  };

  if (setup) return <OnlineSetup onClose={() => setSetup(false)} onReady={(c) => online.setCfg(c)} />;

  return (
    <Modal title="Share this form" onClose={onClose}>
      {online.cfg === undefined ? (
        <Spinner />
      ) : !online.cfg ? (
        <>
          <p className="muted">Get a link anyone can open on their phone or computer to fill in this form. Their answers come back to Responses here.</p>
          <p className="muted">This needs a free online database that you own. You set it up once, in about five minutes.</p>
          <div className="modal-foot">
            <button onClick={onSaveFile}>Save as a file instead</button>
            <span className="grow" />
            <button className="primary" onClick={() => setSetup(true)}>Set up online forms</button>
          </div>
        </>
      ) : !form.online ? (
        <>
          <p className="muted">Anyone with the link can fill in this form from a phone or computer, without Forma or an account. Their answers come back to Responses here.</p>
          {!form.questions.length && <p className="form-error">Add at least one question first.</p>}
          <div className="modal-foot">
            <button onClick={onSaveFile}>Save as a file instead</button>
            <span className="grow" />
            <button className="primary" disabled={working || !form.questions.length} onClick={() => run(online.share)}>
              {working && <Spinner />} Create link
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="share-link">
            <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Form link" />
            <button
              className="primary"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="muted small">Send this link by WhatsApp, email or anywhere else. Changes you make to the questions show up in the link automatically.</p>
          <section className="setting">
            <div>
              <div className="setting-title">Accepting responses</div>
              <div className="muted small">{form.online.accepting ? "People can fill in the form." : "The link shows that the form is closed."}</div>
            </div>
            <label className="switch">
              <input type="checkbox" role="switch" checked={form.online.accepting} disabled={working} onChange={(e) => run(() => online.setAccepting(e.target.checked))} />
              <span />
            </label>
          </section>
          <div className="modal-foot">
            <button
              disabled={working}
              onClick={async () => {
                if (await askConfirm("Stop sharing this form?", { body: "The link stops working and the online copy is deleted. Answers you already received stay here in Forma.", danger: true, confirmLabel: "Stop sharing" }))
                  run(online.stop);
              }}
            >
              Stop sharing
            </button>
            <span className="grow" />
            <button onClick={onSaveFile}>Save as a file</button>
            <button onClick={onClose}>Done</button>
          </div>
        </>
      )}
    </Modal>
  );
}
