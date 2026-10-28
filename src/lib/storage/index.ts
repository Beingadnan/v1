import "server-only";

import { env } from "@/lib/env";

import { LocalBlobStore, type BlobStore } from "./blob-store";

/** The app's blob store. Cloud storage replaces this at deployment (phase 12). */
export const blobStore: BlobStore = new LocalBlobStore(env.STORAGE_LOCAL_DIR);

export const uploadMaxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
