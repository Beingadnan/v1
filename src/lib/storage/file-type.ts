/**
 * Decide what a file really is from its first bytes, not from its name.
 * Only the types QA Tech actually exchanges are accepted.
 */
export const ALLOWED_FILE_TYPES = {
  pdf: { extensions: [".pdf"], mime: "application/pdf" },
  xlsx: {
    extensions: [".xlsx"],
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  xls: { extensions: [".xls"], mime: "application/vnd.ms-excel" },
  csv: { extensions: [".csv"], mime: "text/csv" },
  png: { extensions: [".png"], mime: "image/png" },
  jpeg: { extensions: [".jpg", ".jpeg"], mime: "image/jpeg" },
} as const;

export type AllowedFileType = keyof typeof ALLOWED_FILE_TYPES;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  if (sample.length === 0) return false;
  // Binary formats contain NUL bytes; CSV exports from loggers never do.
  return !sample.includes(0);
}

/** Returns the detected type, or null when the content is not an accepted type. */
export function detectFileType(bytes: Uint8Array): AllowedFileType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "xls"; // OLE2
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // A ZIP container; .xlsx always holds a workbook part. Other ZIPs are refused.
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64 * 1024))).toString(
      "latin1",
    );
    return head.includes("xl/") || head.includes("[Content_Types].xml") ? "xlsx" : null;
  }
  return looksLikeText(bytes) ? "csv" : null;
}

/** Lower-case extension including the dot, or "" when there is none. */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot).toLowerCase() : "";
}

/**
 * The file's content must match its extension, so a renamed executable or a
 * PDF called .xlsx is refused with a clear message.
 */
export function checkFileType(
  fileName: string,
  bytes: Uint8Array,
): { ok: true; type: AllowedFileType } | { ok: false; message: string } {
  const detected = detectFileType(bytes);
  const ext = fileExtension(fileName);
  // "Text" is only accepted as CSV; any other text file (.eml, .txt, .html…) is simply not allowed.
  if (!detected || (detected === "csv" && ext !== ".csv")) {
    return {
      ok: false,
      message:
        ext === ".xls"
          ? `${fileName} is an old Excel file (.xls). Open it in Excel and save it as .xlsx, then upload that.`
          : ext === ".txt" && detected === "csv"
            ? `${fileName} is a text export. Rename it to .csv (or export as CSV) and upload that.`
            : `${fileName} is not a PDF, Excel, CSV or image file.`,
    };
  }
  const allowedExtensions: readonly string[] = ALLOWED_FILE_TYPES[detected].extensions;
  if (!allowedExtensions.includes(ext)) {
    return {
      ok: false,
      message: `${fileName} looks like a ${detected.toUpperCase()} file but is named ${ext || "without an extension"}. Rename it or export it again.`,
    };
  }
  return { ok: true, type: detected };
}
