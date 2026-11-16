/**
 * Reads layout sketches (a photo, or a scanned PDF of several pages) with an
 * OpenAI vision model (ADR 0021). One request per file, structured output against SKETCH_JSON_SCHEMA, so the
 * answer is JSON in the expected shape; it is still checked by the caller.
 * No SDK: one HTTPS call.
 */
import { SKETCH_JSON_SCHEMA, SKETCH_PROMPT } from "@/domain/field/sketch";

/**
 * A photo or PDF in, the model's JSON out (unchecked); `model` names what read
 * it. Injected so tests need no network.
 */
export type SketchReader = ((file: { bytes: Uint8Array; mime: string }) => Promise<unknown>) & {
  model?: string;
};

export class SketchReadError extends Error {}

export function openAiSketchReader(options: {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): SketchReader {
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
            { role: "system", content: SKETCH_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Read these layout sketches." },
                // A scanned PDF goes as a file (every page is seen); a photo as an image.
                mime === "application/pdf"
                  ? {
                      type: "file",
                      file: {
                        filename: "sketches.pdf",
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
            json_schema: { name: "layout_sketch", strict: true, schema: SKETCH_JSON_SCHEMA },
          },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 240_000),
      });
    } catch {
      throw new SketchReadError("Couldn't reach OpenAI to read the sketch. Try again.");
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
            : `OpenAI couldn't read the sketch: ${why}`,
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
