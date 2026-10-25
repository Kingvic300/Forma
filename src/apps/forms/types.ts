import type { OnlineForm } from "../../lib/online";

export type QType = "short" | "paragraph" | "choice" | "checkbox" | "dropdown" | "number" | "email" | "date" | "scale";

export interface Question {
  id: string;
  type: QType;
  label: string;
  help?: string;
  required: boolean;
  options: string[];
}

export interface Response {
  at: number;
  answers: Record<string, string | string[]>;
  /** Number of the answer in the online database, for answers that came in from a shared link. */
  rid?: number;
}

export interface FormData {
  title: string;
  description: string;
  color?: string;
  questions: Question[];
  responses: Response[];
  /** Set while the form is shared as an online link. */
  online?: OnlineForm;
}

export const TYPES: [QType, string][] = [
  ["short", "Short answer"],
  ["paragraph", "Paragraph"],
  ["choice", "Multiple choice"],
  ["checkbox", "Checkboxes"],
  ["dropdown", "Dropdown"],
  ["number", "Number"],
  ["email", "Email"],
  ["date", "Date"],
  ["scale", "Linear scale (1–5)"],
];

export const hasOptions = (t: QType) => t === "choice" || t === "checkbox" || t === "dropdown";
