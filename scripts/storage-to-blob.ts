/**
 * Copies every file kept on local disk (STORAGE_LOCAL_DIR) into the Vercel Blob
 * store named by BLOB_READ_WRITE_TOKEN. Run once when switching to Vercel Blob:
 *
 *   npm run storage:to-blob
 *
 * Safe to run again: files already in the store are skipped (keys are content
 * hashes, so the same key always means the same bytes).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { VercelBlobStore } from "../src/lib/storage/vercel-blob-store";

async function* files(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/^[0-9a-f]{64}$/.test(e.name)) yield p;
  }
}

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("Set BLOB_READ_WRITE_TOKEN in .env.local first.");
  const root = path.resolve(process.env.STORAGE_LOCAL_DIR || "./.data/storage");
  const store = new VercelBlobStore(token);
  if (!(await stat(path.join(root, "sha256")).catch(() => null))) {
    console.log(`No local files under ${root}; nothing to copy.`);
    return;
  }
  let copied = 0;
  let had = 0;
  for await (const f of files(path.join(root, "sha256"))) {
    const r = await store.put(path.basename(f), await readFile(f));
    if (r.created) copied += 1;
    else had += 1;
    if ((copied + had) % 25 === 0) console.log(`${copied + had} files...`);
  }
  console.log(`Done: ${copied} copied, ${had} already in the store.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
