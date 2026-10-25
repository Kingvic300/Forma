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

export default function Tracker({ id }: { id: string }) {
  const f = useFile<TrackerData>(id);
  const [newTask, setNewTask] = useState("");
  const [due, setDue] = useState("");
  const [newHabit, setNewHabit] = useState("");
  const [view, setView] = useState<"open" | "done" | "all">("open");

  if (f.missing) return <Missing app="tracker" />;
  if (!f.data || !f.meta) return <div className="loading">Loading…</div>;
  const data = f.data;
  const now = new Date();
  const today = iso(now);
  const week = Array.from({ length: 14 }, (_, i) => addDays(now, i - 13));

  const set = (patch: Partial<TrackerData>) => f.setData({ ...data, ...patch });
  const setTask = (tid: string, patch: Partial<Task>) => set({ tasks: data.tasks.map((t) => (t.id === tid ? { ...t, ...patch } : t)) });
  const toggleDay = (h: Habit, day: string) =>
    set({ habits: data.habits.map((x) => (x.id === h.id ? { ...x, days: x.days.includes(day) ? x.days.filter((d) => d !== day) : [...x.days, day] } : x)) });

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    set({ tasks: [{ id: uid(), title: newTask.trim(), done: false, due: due || undefined, priority: 1, created: Date.now() }, ...data.tasks] });
    setNewTask("");
    setDue("");
  }
  function addHabit(e: React.FormEvent) {
    e.preventDefault();
    if (!newHabit.trim()) return;
    set({ habits: [...data.habits, { id: uid(), name: newHabit.trim(), color: COLORS[data.habits.length % COLORS.length], days: [] }] });
    setNewHabit("");
  }

  const open = data.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < today).length;
  const weekAgo = Date.now() - 7 * 86400000;
  const doneWeek = data.tasks.filter((t) => t.done && (t.doneAt ?? 0) > weekAgo).length;
  const habitsToday = data.habits.filter((h) => h.days.includes(today)).length;
  const last7 = week.slice(-7).map(iso);
  const habitRate = data.habits.length ? Math.round((100 * data.habits.reduce((s, h) => s + last7.filter((d) => h.days.includes(d)).length, 0)) / (7 * data.habits.length)) : 0;

  const shown = data.tasks
    .filter((t) => (view === "open" ? !t.done : view === "done" ? t.done : true))
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "9999").localeCompare(b.due ?? "9999") || b.priority - a.priority || b.created - a.created);

  return (
    <div className="app-page tracker">
      <TitleBar meta={f.meta} onRename={f.rename} saved={f.saved} app="tracker" />
      <div className="tracker-scroll">
        <p className="tracker-summary">
          <b>{open.length}</b> open task{open.length === 1 ? "" : "s"}, {overdue ? <b className="warn">{overdue} overdue</b> : "none overdue"}. <b>{doneWeek}</b> done in the last 7 days.{" "}
          {data.habits.length ? (
            <>
              <b>{habitsToday} of {data.habits.length}</b> habit{data.habits.length === 1 ? "" : "s"} done today, <b>{habitRate}%</b> across the week.
            </>
          ) : (
            "No habits yet."
          )}
        </p>

        <div className="tracker-cols">
          <section className="card">
            <div className="sec-head">
              <h3>Tasks</h3>
              <div className="seg">
                {(["open", "done", "all"] as const).map((v) => (
                  <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
                ))}
              </div>
            </div>
            <form className="add-row" onSubmit={addTask}>
              <input placeholder="Add a task…" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Due date" />
              <button>Add</button>
            </form>
            <ul className="tasks">
              {shown.map((t) => (
                <li key={t.id} className={t.done ? "done" : t.due && t.due < today ? "late" : ""}>
                  <input type="checkbox" checked={t.done} onChange={(e) => setTask(t.id, { done: e.target.checked, doneAt: e.target.checked ? Date.now() : undefined })} />
                  <input className="task-title" value={t.title} onChange={(e) => setTask(t.id, { title: e.target.value })} />
                  <select value={t.priority} onChange={(e) => setTask(t.id, { priority: Number(e.target.value) as Task["priority"] })} className={`prio p${t.priority}`}>
                    {PRIORITY.map((p, i) => <option key={p} value={i}>{p}</option>)}
                  </select>
                  <input type="date" value={t.due ?? ""} onChange={(e) => setTask(t.id, { due: e.target.value || undefined })} />
                  <button className="icon" title="Delete" onClick={() => set({ tasks: data.tasks.filter((x) => x.id !== t.id) })}><X /></button>
                </li>
              ))}
              {!shown.length && <li className="muted empty-row">{view === "open" ? "Nothing open. Nice." : "No tasks here."}</li>}
            </ul>
          </section>

          <section className="card">
            <div className="sec-head"><h3>Habits</h3><span className="muted small">Last 14 days</span></div>
            <form className="add-row" onSubmit={addHabit}>
              <input placeholder="New habit, e.g. Read 20 minutes" value={newHabit} onChange={(e) => setNewHabit(e.target.value)} />
              <button>Add</button>
            </form>
            <div className="habits">
              <div className="habit-row head">
                <span />
                {week.map((d) => <span key={iso(d)} className={"day" + (iso(d) === today ? " today" : "")}>{d.toLocaleDateString(undefined, { weekday: "narrow" })}<br />{d.getDate()}</span>)}
                <span className="streak">Streak</span>
              </div>
              {data.habits.map((h) => (
                <div key={h.id} className="habit-row" style={{ "--h": h.color } as React.CSSProperties}>
                  <span className="habit-name">
                    <input value={h.name} onChange={(e) => set({ habits: data.habits.map((x) => (x.id === h.id ? { ...x, name: e.target.value } : x)) })} />
                    <button className="icon" title="Delete habit" onClick={async () => (await askConfirm(`Delete the habit “${h.name}”?`, { body: "Its history is deleted too.", danger: true, confirmLabel: "Delete habit" })) && set({ habits: data.habits.filter((x) => x.id !== h.id) })}><X /></button>
                  </span>
                  {week.map((d) => {
                    const k = iso(d);
                    return <button key={k} className={"dot" + (h.days.includes(k) ? " on" : "")} title={k} onClick={() => toggleDay(h, k)} />;
                  })}
                  <span className="streak"><b>{streak(h.days, now)}</b> day{streak(h.days, now) === 1 ? "" : "s"}</span>
                </div>
              ))}
              {!data.habits.length && <div className="muted empty-row">Add a habit to start tracking.</div>}
            </div>

            <div className="sec-head journal-head"><h3>Today's note</h3><span className="muted small">{now.toLocaleDateString(undefined, { dateStyle: "full" })}</span></div>
            <textarea
              className="journal"
              rows={5}
              placeholder="How did today go? What did you get done?"
              value={data.notes?.[today] ?? ""}
              onChange={(e) => set({ notes: { ...data.notes, [today]: e.target.value } })}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
