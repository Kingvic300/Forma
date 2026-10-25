import { askConfirm } from "../lib/dialog";
import { useState } from "react";
import { X } from "lucide-react";
import { useFile } from "../lib/useFile";
import { uid } from "../lib/store";
import { Missing, TitleBar } from "../ui";

export interface Task {
  id: string;
  title: string;
  done: boolean;
  due?: string; // YYYY-MM-DD
  priority: 0 | 1 | 2;
  created: number;
  doneAt?: number;
}
export interface Habit {
  id: string;
  name: string;
  color: string;
  days: string[]; // YYYY-MM-DD the habit was done
}
export interface TrackerData {
  tasks: Task[];
  habits: Habit[];
  notes?: Record<string, string>; // daily journal, keyed by date
}

const COLORS = ["#7c9dff", "#4fbf8b", "#e2b25b", "#f07a80", "#b195f5", "#3cc8dc"];
const PRIORITY = ["Low", "Normal", "High"];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function streak(days: string[], today: Date) {
  const set = new Set(days);
  let d = set.has(iso(today)) ? today : addDays(today, -1); // today not done yet keeps yesterday's streak alive
  let n = 0;
  while (set.has(iso(d))) { n++; d = addDays(d, -1); }
  return n;
}
