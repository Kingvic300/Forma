import { askConfirm } from "../../lib/dialog";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from "lucide-react";
import Papa from "papaparse";
import { useFile } from "../../lib/useFile";
import { safeName, saveAs } from "../../lib/platform";
import { createFile, uid } from "../../lib/store";
import { go } from "../../lib/route";
import { Missing, TitleBar } from "../../ui";
import { FormView } from "./FormFill";
import { hasOptions, TYPES, type FormData, type Question } from "./types";

const COLORS = ["#b195f5", "#7c9dff", "#4fbf8b", "#3cc8dc", "#e2b25b", "#f07a80"];

export default function Forms({ id }: { id: string }) {
  const f = useFile<FormData>(id);
  const [tab, setTab] = useState<"edit" | "preview" | "responses">("edit");
  const [focus, setFocus] = useState<string | null>(null);

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
    const { responses: _skip, ...template } = form;
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
        <button onClick={exportForm} title="Share this form as a file other Forma users can open">Share form file</button>
      </TitleBar>
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
          {answers.slice(-50).reverse().map((a, i) => <li key={i}>{[a].flat().join(", ")}</li>)}
        </ul>
      )}
    </div>
  );
}
