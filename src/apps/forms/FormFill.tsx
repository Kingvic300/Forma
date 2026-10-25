import { useEffect, useState } from "react";
import { loadFile, saveFile, type Meta } from "../../lib/store";
import type { FormData, Question, Response } from "./types";

/** The respondent's view of a form. Submissions are appended to the stored file. */
export function FormView({ id, onSubmit }: { id: string; onSubmit?: (r: Response) => void }) {
  const [file, setFile] = useState<{ meta: Meta; data: FormData } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    loadFile<FormData>(id).then(setFile);
  }, [id]);

  if (!file) return <div className="loading">Loading…</div>;
  const form = file.data;
  const set = (q: Question, v: string | string[]) => setAnswers((a) => ({ ...a, [q.id]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const q of form.questions) {
      const a = answers[q.id];
      const empty = a === undefined || a === "" || (Array.isArray(a) && !a.length);
      if (q.required && empty) errs[q.id] = "This is a required question";
      else if (q.type === "email" && !empty && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(a))) errs[q.id] = "Enter a valid email";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const response = { at: Date.now(), answers };
    if (onSubmit) onSubmit(response);
    else {
      // Re-read before writing so edits made in another window aren't overwritten.
      const fresh = await loadFile<FormData>(id);
      if (!fresh) return;
      await saveFile(fresh.meta, { ...fresh.data, responses: [...fresh.data.responses, response] });
    }
    setDone(true);
  }

  if (done)
    return (
      <div className="card form-head done">
        <h1>{form.title}</h1>
        <p>Your response has been recorded.</p>
        <button className="link" onClick={() => { setAnswers({}); setDone(false); }}>Submit another response</button>
      </div>
    );

  return (
    <form onSubmit={submit} className="fill" noValidate>
      <div className="card form-head">
        <h1>{form.title}</h1>
        {form.description && <p className="pre">{form.description}</p>}
        {form.questions.some((q) => q.required) && <p className="req-note">* Indicates required question</p>}
      </div>
      {form.questions.map((q) => (
        <div key={q.id} className={"card q" + (errors[q.id] ? " invalid" : "")}>
          <div className="q-title">{q.label || "Untitled question"}{q.required && <span className="req"> *</span>}</div>
          {q.help && <div className="muted">{q.help}</div>}
          <Field q={q} value={answers[q.id]} onChange={(v) => set(q, v)} />
          {errors[q.id] && <div className="error">{errors[q.id]}</div>}
        </div>
      ))}
      <div className="fill-foot">
        <button type="submit" className="primary">Submit</button>
        <button type="button" className="link" onClick={() => setAnswers({})}>Clear form</button>
      </div>
    </form>
  );
}

function Field({ q, value, onChange }: { q: Question; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const v = typeof value === "string" ? value : "";
  switch (q.type) {
    case "paragraph":
      return <textarea className="answer" rows={3} value={v} onChange={(e) => onChange(e.target.value)} placeholder="Your answer" />;
    case "choice":
      return (
        <div className="choices">
          {q.options.map((o) => (
            <label key={o}><input type="radio" name={q.id} checked={v === o} onChange={() => onChange(o)} /> {o}</label>
          ))}
        </div>
      );
    case "checkbox": {
      const list = Array.isArray(value) ? value : [];
      return (
        <div className="choices">
          {q.options.map((o) => (
            <label key={o}>
              <input type="checkbox" checked={list.includes(o)} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} /> {o}
            </label>
          ))}
        </div>
      );
    }
    case "dropdown":
      return (
        <select className="answer" value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose</option>
          {q.options.map((o) => <option key={o}>{o}</option>)}
        </select>
      );
    case "scale":
      return (
        <div className="scale">
          {["1", "2", "3", "4", "5"].map((n) => (
            <label key={n}><span>{n}</span><input type="radio" name={q.id} checked={v === n} onChange={() => onChange(n)} /></label>
          ))}
        </div>
      );
    default:
      return <input className="answer" type={q.type === "short" ? "text" : q.type} value={v} onChange={(e) => onChange(e.target.value)} placeholder="Your answer" />;
  }
}
