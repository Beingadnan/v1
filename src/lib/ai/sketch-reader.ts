/**
 * Reads scanned paper (a photo, or a PDF of several pages) with a vision
 * model, Claude or OpenAI: layout sketches (ADR 0021) and calibration
 * certificates (ADR 0024). One request per file, structured output against
 * the task's JSON schema, so the answer is JSON in the expected shape; it is
 * still checked by the caller. No SDK: one HTTPS call.
 */
import { SKETCH_JSON_SCHEMA, SKETCH_PROMPT } from "@/domain/field/sketch";

/** What to read: the instructions, the answer's schema and its name. */
export type ReadTask = {
  name: string;
  description: string;
  prompt: string;
  schema: object;
  ask: string;
};

export const SKETCH_TASK: ReadTask = {
  name: "layout_sketch",
  description: "Record every room read from the sketches.",
  prompt: SKETCH_PROMPT,
  schema: SKETCH_JSON_SCHEMA,
  ask: "Read these layout sketches.",
};

/**
 * A photo or PDF in, the model's JSON out (unchecked); `model` names what read
 * it. Injected so tests need no network.
 */
export type SketchReader = ((file: { bytes: Uint8Array; mime: string }) => Promise<unknown>) & {
  model?: string;
};

export class SketchReadError extends Error {}

type ReaderOptions = {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  task?: ReadTask;
};

export function openAiSketchReader(options: ReaderOptions): SketchReader {
  const task = options.task ?? SKETCH_TASK;
  const call = options.fetch ?? fetch;
  const reader: SketchReader = async ({ bytes, mime }) => {
    const reasoning = /^(gpt-5|o\d)/.test(options.model) ? { reasoning_effort: "low" } : {};
    let res: Response;
    try {
      res = await call("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          ...reasoning,
          messages: [
            { role: "system", content: task.prompt },
            {
              role: "user",
              content: [
                { type: "text", text: task.ask },
                // A scanned PDF goes as a file (every page is seen); a photo as an image.
                mime === "application/pdf"
                  ? {
                      type: "file",
                      file: {
                        filename: "scan.pdf",
                        file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`,
                      },
                    }
                  : {
                      type: "image_url",
                      image_url: {
                        url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
                        detail: "high",
                      },
                    },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: task.name, strict: true, schema: task.schema },
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 240_000),
      });
    } catch {
      throw new SketchReadError("Couldn't reach OpenAI to read the file. Try again.");
    }
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    } | null;
    if (!res.ok) {
      const why = body?.error?.message ?? `HTTP ${res.status}`;
      throw new SketchReadError(
        res.status === 401
          ? "OpenAI refused the API key. Check OPENAI_API_KEY."
          : res.status === 429
            ? "OpenAI's limit or credit is used up. Try later, or add credit."
            : `OpenAI couldn't read the file: ${why}`,
      );
    }
    const message = body?.choices?.[0]?.message;
    if (message?.refusal) throw new SketchReadError(`OpenAI declined: ${message.refusal}`);
    try {
      return JSON.parse(message?.content ?? "");
    } catch {
      throw new SketchReadError("OpenAI's answer wasn't readable. Try again.");
    }
  };
  reader.model = options.model;
  return reader;
}

/**
 * The same with Claude (Anthropic API): the file goes as a document (PDF) or
 * an image, and the answer comes back as the input of a tool the model must
 * call, whose schema is SKETCH_JSON_SCHEMA. Claude Haiku is the cheapest
 * reader (ADR 0021).
 */
export function claudeSketchReader(options: ReaderOptions): SketchReader {
  const task = options.task ?? SKETCH_TASK;
  const call = options.fetch ?? fetch;
  const reader: SketchReader = async ({ bytes, mime }) => {
    const data = Buffer.from(bytes).toString("base64");
    let res: Response;
    try {
      res = await call("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 16_000,
          system: task.prompt,
          tools: [{ name: task.name, description: task.description, input_schema: task.schema }],
          tool_choice: { type: "tool", name: task.name },
          messages: [
            {
              role: "user",
              content: [
                mime === "application/pdf"
                  ? { type: "document", source: { type: "base64", media_type: mime, data } }
                  : { type: "image", source: { type: "base64", media_type: mime, data } },
                { type: "text", text: task.ask },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 240_000),
      });
    } catch {
      throw new SketchReadError("Couldn't reach Claude to read the file. Try again.");
    }
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      content?: { type: string; name?: string; input?: unknown }[];
      stop_reason?: string;
    } | null;
    if (!res.ok) {
      const why = body?.error?.message ?? `HTTP ${res.status}`;
      throw new SketchReadError(
        res.status === 401
          ? "Claude refused the API key. Check ANTHROPIC_API_KEY."
          : res.status === 429 || /credit/i.test(why)
            ? "Claude's limit or credit is used up. Try later, or add credit in the Claude Console."
            : `Claude couldn't read the file: ${why}`,
      );
    }
    const used = body?.content?.find((c) => c.type === "tool_use" && c.name === task.name);
    if (!used || body?.stop_reason === "max_tokens") {
      throw new SketchReadError("Claude's answer wasn't complete. Try again, or a smaller file.");
    }
    return used.input;
  };
  reader.model = options.model;
  return reader;
}
