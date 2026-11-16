import "server-only";

import { env } from "@/lib/env";

import { openAiSketchReader, type SketchReader } from "./sketch-reader";

/** The app's sketch reader, or null when no OpenAI key is set (ADR 0021). */
export const sketchReader: SketchReader | null = env.OPENAI_API_KEY
  ? openAiSketchReader({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_SKETCH_MODEL })
  : null;
