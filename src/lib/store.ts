// Local file storage. Everything lives in IndexedDB inside the app's data folder;
// metadata and contents are stored under separate keys so listing stays cheap.
import { useEffect, useState } from "react";
import { createStore, del, get, getMany, keys, set } from "idb-keyval";

const db = createStore("forma-db", "files");

export type Kind = "docs" | "sheets" | "forms" | "pdf" | "tracker";

export interface Meta {
  id: string;
  kind: Kind;
  name: string;
  updated: number;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function useFiles(kind?: Kind) {
  const [files, setFiles] = useState<Meta[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => listFiles(kind).then((f) => alive && setFiles(f));
    load();
    addEventListener(FILES_CHANGED, load);
    return () => {
      alive = false;
      removeEventListener(FILES_CHANGED, load);
    };
  }, [kind]);
  return files;
}

export async function listFiles(kind?: Kind): Promise<Meta[]> {
  const ks = (await keys(db)).filter((k) => String(k).startsWith("meta:"));
  const all = (await getMany<Meta | undefined>(ks, db)).filter((m): m is Meta => !!m);
  return all.filter((m) => !kind || m.kind === kind).sort((a, b) => b.updated - a.updated);
}

export async function loadFile<T>(id: string): Promise<{ meta: Meta; data: T } | null> {
  const [meta, data] = await getMany([`meta:${id}`, `data:${id}`], db);
  return meta ? { meta, data } : null;
}

/** Fired whenever the file list changes, so lists elsewhere in the window can refresh. */
export const FILES_CHANGED = "forma:files-changed";
const changed = () => dispatchEvent(new Event(FILES_CHANGED));

export async function saveFile<T>(meta: Meta, data: T) {
  const m = { ...meta, updated: Date.now() };
  await set(`data:${meta.id}`, data, db);
  await set(`meta:${meta.id}`, m, db);
  changed();
  return m;
}

export async function saveMeta(meta: Meta) {
  await set(`meta:${meta.id}`, { ...meta, updated: Date.now() }, db);
  changed();
}

export async function createFile<T>(kind: Kind, name: string, data: T) {
  const meta: Meta = { id: uid(), kind, name, updated: Date.now() };
  await saveFile(meta, data);
  return meta.id;
}

export async function deleteFile(id: string) {
  await del(`meta:${id}`, db);
  await del(`data:${id}`, db);
  changed();
}

export const getSetting = <T>(k: string) => get<T>(`set:${k}`, db);
export const setSetting = <T>(k: string, v: T) => set(`set:${k}`, v, db);
