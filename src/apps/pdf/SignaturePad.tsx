import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getSetting, setSetting } from "../../lib/store";
import { Modal } from "../../ui";

const SCRIPTS = ["Allura", "Caveat"];
const INKS = ["#111111", "#1a3fb0", "#b71c1c"];

/** Crop transparent margins from a canvas and return a PNG data URL. */
function trimmed(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  let x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (px[(y * width + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
  if (x2 < 0) return null;
  const pad = 6;
  const out = document.createElement("canvas");
  out.width = x2 - x1 + pad * 2;
  out.height = y2 - y1 + pad * 2;
  out.getContext("2d")!.drawImage(canvas, x1 - pad, y1 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Convert any image file to a PNG data URL (pdf-lib embeds PNG reliably). */
export async function imageToPng(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function SignaturePad({ title = "Add signature", onPick, onClose }: { title?: string; onPick: (src: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"saved" | "draw" | "type" | "upload">("draw");
  const [saved, setSaved] = useState<string[]>([]);
  const [ink, setInk] = useState(INKS[0]);
  const [typed, setTyped] = useState("");
  const [script, setScript] = useState(SCRIPTS[0]);
  const [remember, setRemember] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getSetting<string[]>("signatures").then((s) => {
      setSaved(s ?? []);
      if (s?.length) setTab("saved");
    });
  }, []);

  async function finish(src: string | null) {
    if (!src) return;
    if (remember && !saved.includes(src)) await setSetting("signatures", [src, ...saved].slice(0, 8));
    onPick(src);
  }

  function typedPng() {
    const c = document.createElement("canvas");
    c.width = 900;
    c.height = 260;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = ink;
    ctx.font = `${script === "Allura" ? 120 : 104}px '${script}', cursive`;
    ctx.textBaseline = "middle";
    ctx.fillText(typed, 20, 130);
    return trimmed(c);
  }

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * e.currentTarget.width, y: ((e.clientY - r.top) / r.height) * e.currentTarget.height };
  };

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="seg">
        {saved.length > 0 && <button className={tab === "saved" ? "on" : ""} onClick={() => setTab("saved")}>Saved</button>}
        <button className={tab === "draw" ? "on" : ""} onClick={() => setTab("draw")}>Draw</button>
        <button className={tab === "type" ? "on" : ""} onClick={() => setTab("type")}>Type</button>
        <button className={tab === "upload" ? "on" : ""} onClick={() => setTab("upload")}>Upload image</button>
      </div>

      {tab === "saved" && (
        <div className="sig-saved">
          {saved.map((s) => (
            <div key={s} className="sig-tile">
              <button onClick={() => onPick(s)}><img src={s} alt="Saved signature" /></button>
              <button className="icon" title="Forget" onClick={async () => { const next = saved.filter((x) => x !== s); setSaved(next); await setSetting("signatures", next); }}><X /></button>
            </div>
          ))}
        </div>
      )}

      {tab !== "saved" && tab !== "upload" && (
        <div className="inks">
          {INKS.map((c) => <button key={c} className={c === ink ? "on" : ""} style={{ background: c }} onClick={() => setInk(c)} aria-label={`Ink ${c}`} />)}
        </div>
      )}

      {tab === "draw" && (
        <>
          <canvas
            ref={canvas}
            className="sig-canvas"
            width={900}
            height={300}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = point(e); }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = e.currentTarget.getContext("2d")!;
              const p = point(e);
              ctx.strokeStyle = ink;
              ctx.lineWidth = 5;
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.beginPath();
              ctx.moveTo(drawing.current.x, drawing.current.y);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
              drawing.current = p;
              setDirty(true);
            }}
            onPointerUp={() => (drawing.current = null)}
          />
          <div className="sig-line">Sign above</div>
        </>
      )}

      {tab === "type" && (
        <div className="sig-type">
          <input autoFocus placeholder="Type your name" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <div className="sig-fonts">
            {SCRIPTS.map((s) => (
              <button key={s} className={s === script ? "on" : ""} style={{ fontFamily: `'${s}', cursive`, color: ink }} onClick={() => setScript(s)}>
                {typed || "Your Name"}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "upload" && (
        <label className="drop">
          Choose a photo or scan of your signature (PNG with transparent background works best)
          <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) finish(await imageToPng(f)); }} />
        </label>
      )}

      {tab !== "saved" && (
        <div className="modal-foot">
          <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this computer</label>
          <span className="grow" />
          {tab === "draw" && <button onClick={() => { canvas.current!.getContext("2d")!.clearRect(0, 0, 900, 300); setDirty(false); }}>Clear</button>}
          {tab !== "upload" && (
            <button className="primary" disabled={tab === "draw" ? !dirty : !typed.trim()} onClick={() => finish(tab === "draw" ? trimmed(canvas.current!) : typedPng())}>
              Use signature
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
