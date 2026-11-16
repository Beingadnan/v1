/**
 * Tries the layout sketch reader on photos, without the app (ADR 0021):
 *
 *   npm run layout:read -- sketches.pdf photo.jpg
 *
 * Needs OPENAI_API_KEY (and optionally OPENAI_SKETCH_MODEL) in .env.local. For
 * each file it writes <file>.diagrams.html next to it: every room read,
 * drawn as the report's diagram (16 loggers spread where none are drawn), with
 * what to check. Nothing is saved.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";

import { LayoutDiagram } from "@/app/(staff)/studies/[studyId]/layout-diagram";
import { layoutFromRoom, sketchReadingSchema } from "@/domain/field/sketch";
import { openAiSketchReader } from "@/lib/ai/sketch-reader";

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Set OPENAI_API_KEY in .env.local first.");
  if (!files.length)
    throw new Error("Usage: npm run layout:read -- <sketches.pdf or photo.jpg> [more]");
  const model = process.env.OPENAI_SKETCH_MODEL?.trim() || "gpt-5-mini";
  const read = openAiSketchReader({ apiKey, model });
  const loggers = 16;
  for (const file of files) {
    const bytes = new Uint8Array(await readFile(file));
    const mime = /\.pdf$/i.test(file)
      ? "application/pdf"
      : /\.png$/i.test(file)
        ? "image/png"
        : "image/jpeg";
    const started = Date.now();
    const parsed = sketchReadingSchema.safeParse(await read({ bytes, mime }));
    if (!parsed.success) {
      console.log(`${file}: not readable as layouts`);
      continue;
    }
    const rooms = parsed.data.rooms.map((room) => {
      const layout = layoutFromRoom(room, loggers);
      const svg = renderToStaticMarkup(
        <LayoutDiagram
          dims={{ lengthM: null, widthM: null, heightM: null, shape: layout.shape }}
          points={layout.points}
          features={layout.features}
        />,
      );
      return `<section style="break-inside:avoid;margin-bottom:24px"><h2>${esc(room.name || room.code || "Room")} <small>page ${room.page}</small></h2>${svg}
<p>${room.kind}, ${room.orientation}; ${room.doors.length} doors; ${room.objects.map((o) => esc(o.label || o.kind)).join(", ") || "nothing inside"}.</p>
<ul>${layout.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>`;
    });
    const out = `${file}.diagrams.html`;
    await writeFile(
      out,
      `<!doctype html><meta charset="utf-8"><title>${esc(path.basename(file))}</title>
<body style="font-family:sans-serif;margin:16px;max-width:900px">
<h1>${esc(path.basename(file))}: ${rooms.length} rooms</h1>
${parsed.data.notes ? `<p>${esc(parsed.data.notes)}</p>` : ""}${rooms.join("\n")}
<details><summary>What was read</summary><pre style="font-size:11px;white-space:pre-wrap">${esc(JSON.stringify(parsed.data, null, 1))}</pre></details>`,
    );
    console.log(
      `${file}: ${rooms.length} rooms in ${((Date.now() - started) / 1000).toFixed(1)} s → ${out}`,
    );
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
