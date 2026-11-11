import "server-only";

import { env } from "@/lib/env";

import { LocalBlobStore, type BlobStore } from "./blob-store";
import { VercelBlobStore } from "./vercel-blob-store";

/** The app's blob store: Vercel Blob when its token is set, else local disk (ADR 0019). */
export const blobStore: BlobStore = env.BLOB_READ_WRITE_TOKEN
  ? new VercelBlobStore(env.BLOB_READ_WRITE_TOKEN)
  : new LocalBlobStore(env.STORAGE_LOCAL_DIR);

export const uploadMaxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
