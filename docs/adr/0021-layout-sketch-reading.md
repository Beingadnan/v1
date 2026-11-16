# ADR 0021 — Layouts read from the engineer's sketch

Status: accepted (13 Nov 2026). Replaces typing the room size on the Layout tab.

## Context

On site the field engineer draws the layout by hand: the room or box, its door and racks,
and each logger with its label, coloured or marked by level (top, middle, bottom). The
office then redrew it as "Diagram indicating sensor locations" for the report. The app
asked instead for length × width × height and a template, which nobody had measured.

Update, 15 Nov 2026: QA Tech's real sketches (Abbott, Nov 2026) are a scanned PDF, one or
two rooms a page, each titled with its ID ("5-ML-05 Cooling Zone"). They show the room,
its doors and what stands in it (cupboards, pass boxes, LAF, autoclaves, AHU…), but no
loggers: the sketch is drawn before the loggers go in.

## Decision

1. **Read the file with a small vision model.** The Layout tab has "Read a sketch": the
   scanned PDF or a photo is uploaded like any file (kept, content-addressed), then sent
   once to OpenAI (a PDF as a file input: every page is seen)
   (`OPENAI_SKETCH_MODEL`, default `gpt-5-mini`, reasoning effort low) with a strict JSON
   schema (`SKETCH_JSON_SCHEMA`): every room drawn, with its title and ID, page, kind
   (room or box), standing or lying, proportions, doors, the objects inside (footprint,
   height, shelves, label) and any loggers drawn (label, level, place).
   - **Read once per file.** The reading is kept (`layout_sketch_readings`); every study
     the same PDF covers takes its room from it without another call.
   - **The study's room is found by its ID** (`matchRoom`: 5-ML-05 = 5ML05, or in the
     title, or the equipment's name); when unsure the engineer picks it from a list.
   - **No loggers drawn:** the study's logger count is spread by the template inside the
     drawn shape, to be moved to where they were placed.
   - Cost: about 1–2 thousand input tokens a page and a few hundred output tokens a room:
     on gpt-5-mini roughly $0.01–0.02 (₹1–2) for a 9-page site PDF, read once; a photo
     under ₹0.50. `gpt-5-nano` is about a fifth of that, at some cost in accuracy on
     handwriting. Set by `OPENAI_SKETCH_MODEL`.
   - No SDK: one HTTPS call (`src/lib/ai/sketch-reader.ts`), injected so tests use no
     network.
2. **Never trust the answer.** It is checked again with zod, labels are written the app's
   way (`L1` → `L-01`), duplicates and gaps are listed, the count is compared with the
   study's loggers, and the shape is made to agree with standing or lying
   (`layoutFromRoom`, `shapeOf`). Doors, pass boxes, LAF/BSC, AHU and heat sources
   (autoclave, oven) also become plan marks. The engineer sees the diagram and the warnings, then
   chooses "Use this layout", which only fills the editor; Save is still theirs.
3. **The shape replaces the typed size.** The proportions, orientation and objects are kept
   on the study (`studies.room_shape`) with the photo (`layout_sketch_file_id`). Drawings
   use the measured size when all three are on the equipment, otherwise the sketch's
   shape (`sizeOf`). Sizes are printed only when measured.
4. **Audited.** Reading records `study.sketch_read` with the reading, since the photo left
   the server; saving records `study.layout_saved` with the shape and photo.
5. **Without a key there is no button.** Everything else works as before.

## Consequences

- The client's sketch goes to OpenAI. It shows a room and labels, not product or patient
  data; API inputs are not used for training by default.
- Accuracy depends on the photo. `npm run layout:read -- sketches.pdf` writes every room's
  diagram next to the file to try many sketches before go-live.

## Update, 16 Nov 2026: Claude as the reader

QA Tech asked to use Claude. With `ANTHROPIC_API_KEY` set, sketches are read by Claude
(`CLAUDE_SKETCH_MODEL`, default `claude-haiku-5-5`) through the Messages API: the PDF goes
as a document (a photo as an image) and the answer comes back as the input of a forced
tool whose schema is `SKETCH_JSON_SCHEMA`. OpenAI stays as the fallback when only its key
is set. Claude Haiku 5.5 costs $0.10 per million input tokens and $0.50 per million output
tokens (prompts under 100k tokens), so a photo is about 10 paise and a 9-page site PDF
about 40 paise, read once. API use is billed in the Claude Console, separately from a
Claude Pro subscription.
