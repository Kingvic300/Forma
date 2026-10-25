import { useCallback, useEffect, useRef, useState } from "react";
import { loadFile, saveFile, type Meta } from "./store";

/** Loads a file and autosaves every change (debounced). */
export function useFile<T>(id: string) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setDataState] = useState<T | null>(null);
  const [missing, setMissing] = useState(false);
  const [saved, setSaved] = useState(true);
  const latest = useRef<{ meta: Meta | null; data: T | null }>({ meta: null, data: null });
  const timer = useRef<number>();

  const write = useCallback(() => {
    timer.current = undefined;
    const { meta, data } = latest.current;
    if (meta && data) saveFile(meta, data).then(() => setSaved(true));
  }, []);

  const flush = useCallback(() => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    write();
  }, [write]);

  useEffect(() => {
    let alive = true;
    loadFile<T>(id).then((f) => {
      if (!alive) return;
      if (!f) return setMissing(true);
      latest.current = { meta: f.meta, data: f.data };
      setMeta(f.meta);
      setDataState(f.data);
    });
    addEventListener("beforeunload", flush);
    return () => {
      alive = false;
      removeEventListener("beforeunload", flush);
      flush();
    };
  }, [id, flush]);

  const schedule = useCallback(() => {
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(write, 500);
  }, [write]);

  const setData = useCallback(
    (next: T | ((d: T) => T)) => {
      const value = typeof next === "function" ? (next as (d: T) => T)(latest.current.data as T) : next;
      latest.current.data = value;
      setDataState(value);
      schedule();
    },
    [schedule],
  );

  const rename = useCallback(
    (name: string) => {
      const m = { ...latest.current.meta!, name };
      latest.current.meta = m;
      setMeta(m);
      schedule();
    },
    [schedule],
  );

  return { meta, data, setData, rename, saved, missing, flush };
}
