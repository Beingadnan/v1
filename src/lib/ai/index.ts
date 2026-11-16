import "server-only";

import { CERTIFICATE_JSON_SCHEMA, CERTIFICATE_PROMPT } from "@/domain/instruments/certificate-scan";
import { env } from "@/lib/env";

import {
  claudeSketchReader,
  openAiSketchReader,
  type ReadTask,
  type SketchReader,
} from "./sketch-reader";

function readerFor(task?: ReadTask): SketchReader | null {
  return env.ANTHROPIC_API_KEY
    ? claudeSketchReader({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_SKETCH_MODEL, task })
    : env.OPENAI_API_KEY
      ? openAiSketchReader({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_SKETCH_MODEL, task })
      : null;
}

/**
 * The app's sketch reader (ADR 0021): Claude when ANTHROPIC_API_KEY is set,
 * else OpenAI when OPENAI_API_KEY is, else none.
 */
export const sketchReader: SketchReader | null = readerFor();

/** The same model reading calibration certificate scans (ADR 0024). */
export const certificateReader: SketchReader | null = readerFor({
  name: "calibration_certificates",
  description: "Record every calibration certificate in the file.",
  prompt: CERTIFICATE_PROMPT,
  schema: CERTIFICATE_JSON_SCHEMA,
  ask: "Read these calibration certificates.",
});
