import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";

export type MenuItem = {
  label: string;
  keys?: string;
  icon?: ReactNode;
  run?: () => void;
  checked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  sub?: MenuEntry[];
  /** Custom content in place of a submenu (for example the table size grid). Gets a function that closes the menu. */
  render?: (close: () => void) => ReactNode;
};
export type MenuEntry = MenuItem | "-";

const keep = (e: React.MouseEvent) => {
  // Keep the text selection in the page while using menus; inputs still need the click.
  if (!(e.target as HTMLElement).closest("input,select,textarea")) e.preventDefault();
};

/** Drop hidden items and separators that end up doubled or at the ends. */
function visible(items: MenuEntry[]) {
  const out = items.filter((i) => i === "-" || !i.hidden);
  return out.filter((i, n) => i !== "-" || (n > 0 && n < out.length - 1 && out[n - 1] !== "-"));
}

function MenuList({ items, close, level = 0 }: { items: MenuEntry[]; close: () => void; level?: number }) {
  const [open, setOpen] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  // Keep the list on screen: flip a submenu to the left or move it up when it would spill out.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (level && r.right > innerWidth - 4) el.classList.add("flip");
    if (level && r.bottom > innerHeight - 4) el.style.transform = `translateY(${-Math.min(r.top - 4, r.bottom - innerHeight + 4)}px)`;
  }, [level]);
  const list = visible(items);
  return (
    <div ref={ref} className={"dmenu pop" + (level ? " sub" : "")} role="menu" onMouseDown={keep}>
      {list.map((it, i) =>
        it === "-" ? (
          <div key={i} className="dsep" />
        ) : (
          <div
            key={i}
            className="ditem-wrap"
            onMouseEnter={() => {
              clearTimeout(timer.current);
              timer.current = window.setTimeout(() => setOpen(i), it.sub || it.render ? 60 : 120);
            }}
          >
            <button
              role="menuitem"
              className={"ditem" + (open === i && (it.sub || it.render) ? " open" : "")}
              disabled={it.disabled}
              onClick={() => {
                if (it.sub || it.render) return setOpen(i);
                close();
                it.run?.();
              }}
            >
              <span className="dicon">{it.checked ? <Check size={14} /> : it.icon}</span>
              <span className="dlabel">{it.label}</span>
              {it.keys && <span className="dkeys">{it.keys}</span>}
              {(it.sub || it.render) && <ChevronRight size={14} className="dchev" />}
            </button>
            {open === i && !it.disabled && it.sub && <MenuList items={it.sub} close={close} level={level + 1} />}
            {open === i && !it.disabled && it.render && (
              <div className="dmenu pop sub custom" onMouseDown={keep}>
                {it.render(close)}
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function useOutside(active: boolean, ref: React.RefObject<HTMLElement>, onOut: () => void) {
  useEffect(() => {
    if (!active) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onOut();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onOut();
    const blur = () => onOut();
    addEventListener("mousedown", down, true);
    addEventListener("keydown", key);
    addEventListener("blur", blur);
    return () => {
      removeEventListener("mousedown", down, true);
      removeEventListener("keydown", key);
      removeEventListener("blur", blur);
    };
  }, [active]);
}

/** File / Edit / View … across the top. Once one is open, hovering the others switches to them. */
export function MenuBar({ menus }: { menus: { label: string; items: MenuEntry[] }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(open !== null, ref, () => setOpen(null));
  return (
    <div className="dmenubar" ref={ref} onMouseDown={keep}>
      {menus.map((m, i) => (
        <div key={m.label} className="dtop-wrap" onMouseEnter={() => open !== null && setOpen(i)}>
          <button className={"dtop" + (open === i ? " on" : "")} onClick={() => setOpen(open === i ? null : i)}>
            {m.label}
          </button>
          {open === i && <MenuList items={m.items} close={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}

/** The right-click menu, kept inside the window. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useOutside(true, ref, onClose);
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, innerWidth - r.width - 4)), y: Math.max(4, Math.min(y, innerHeight - r.height - 4)) });
  }, [x, y]);
  useEffect(() => {
    addEventListener("scroll", onClose, true);
    return () => removeEventListener("scroll", onClose, true);
  }, []);
  return (
    <div ref={ref} className="dctx" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} close={onClose} />
    </div>
  );
}

/** Every runnable item with its path, for "Search the menus". */
export function flatten(menus: { label: string; items: MenuEntry[] }[]) {
  const out: { path: string; item: MenuItem }[] = [];
  const walk = (items: MenuEntry[], path: string) => {
    for (const it of items) {
      if (it === "-" || it.hidden || it.disabled) continue;
      if (it.sub) walk(it.sub, `${path} › ${it.label}`);
      else if (it.run) out.push({ path: `${path} › ${it.label}`, item: it });
    }
  };
  for (const m of menus) walk(m.items, m.label);
  return out;
}

/** A small dropdown for a toolbar button (alignment, line spacing, lists). */
export function ToolMenu({ label, title, items, className }: { label: ReactNode; title: string; items: MenuEntry[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(open, ref, () => setOpen(false));
  return (
    <div className="dtool" ref={ref} onMouseDown={keep}>
      <button className={className} title={title} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && <MenuList items={items} close={() => setOpen(false)} />}
    </div>
  );
}
