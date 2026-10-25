import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import type { Ann, Font, PdfData } from "./types";

const hex = (h = "#000000") => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

// The standard PDF fonts only cover Latin-1.
const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

const FONT: Record<Font, [StandardFonts, StandardFonts]> = {
  helv: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

export interface FieldInfo {
  name: string;
  kind: "text" | "check" | "choice";
  value: string | boolean;
  options?: string[];
}

export async function readFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    return pdf.getForm().getFields().flatMap((f): FieldInfo[] => {
      const name = f.getName();
      if (f instanceof PDFTextField) return [{ name, kind: "text", value: f.getText() ?? "" }];
      if (f instanceof PDFCheckBox) return [{ name, kind: "check", value: f.isChecked() }];
      if (f instanceof PDFDropdown) return [{ name, kind: "choice", value: f.getSelected()[0] ?? "", options: f.getOptions() }];
      if (f instanceof PDFRadioGroup) return [{ name, kind: "choice", value: f.getSelected() ?? "", options: f.getOptions() }];
      return [];
    });
  } catch {
    return [];
  }
}
