import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "./lib/dialog";
import { openLink } from "./lib/links";
import { checkConfig, getOnlineConfig, normalizeConfig, rpc, setOnlineConfig, SETUP_SQL, type OnlineConfig } from "./lib/online";
import { Modal, Spinner } from "./ui";

/** One-time setup for online forms: the user's own free Supabase project. */
export function OnlineSetup({ onClose, onReady }: { onClose: () => void; onReady?: (cfg: OnlineConfig) => void }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<OnlineConfig | null>(null);

  useEffect(() => {
    getOnlineConfig().then((c) => {
      if (!c) return;
      setSaved(c);
      setUrl(c.url);
      setKey(c.key);
    });
  }, []);

  async function copySql() {
    await navigator.clipboard.writeText(SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function save() {
    const problem = checkConfig(url, key);
    if (problem) return setError(problem);
    const cfg = normalizeConfig({ url, key });
    setBusy(true);
    setError("");
    try {
      await rpc(cfg, "forma_get_form", { p_id: "connection-check-000" }); // returns null when set up correctly
      await setOnlineConfig(cfg);
      toast("Online forms are ready", "success");
      onReady?.(cfg);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    await setOnlineConfig(null);
    toast("Online forms turned off on this computer");
    onClose();
  }

  return (
    <Modal title="Set up online forms" onClose={onClose} wide>
      <p className="muted">
        To let anyone fill in your forms from a link, Forma keeps the form and the answers in a free online database that belongs to you. You only do this
        once, and it takes about five minutes.
      </p>
      <ol className="steps">
        <li>
          <b>Create a free Supabase account and project.</b>
          <span>
            Sign up at supabase.com and click <i>New project</i>. Any name and region will do. Save the database password somewhere safe; Forma doesn't need it.
          </span>
          <button className="link" onClick={() => openLink("https://supabase.com/dashboard/new")}>
            Open supabase.com <ExternalLink />
          </button>
        </li>
        <li>
          <b>Paste Forma's setup code.</b>
          <span>
            In your project, open <i>SQL Editor</i>, paste the code, and click <i>Run</i>. It creates two locked tables and the few actions Forma is allowed to do.
          </span>
          <button onClick={copySql}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy setup code"}</button>
        </li>
        <li>
          <b>Copy two values into the boxes below.</b>
          <span>
            In <i>Project Settings → Data API</i> copy the <i>Project URL</i>. In <i>Project Settings → API Keys</i> copy the <i>publishable</i> key (older projects
            call it the <i>anon public</i> key). Never paste the secret or service_role key.
          </span>
        </li>
      </ol>
      <label className="field">
        <span>Project URL</span>
        <input value={url} placeholder="https://abcdefgh.supabase.co" onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
      </label>
      <label className="field">
        <span>Publishable (public) key</span>
        <input value={key} placeholder="sb_publishable_… or eyJ…" onChange={(e) => setKey(e.target.value)} spellCheck={false} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-foot">
        {saved && <button onClick={disconnect}>Turn off</button>}
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !url.trim() || !key.trim()} onClick={save}>
          {busy && <Spinner />} Check and save
        </button>
      </div>
    </Modal>
  );
}
