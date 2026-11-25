import { NextResponse, type NextRequest } from "next/server";

import { uploadMaxBytes } from "@/lib/storage";
import { storeAndRespond, tooLarge, uploader } from "@/lib/storage/upload-route";

/**
 * POST /api/files — upload one file (multipart field "file").
 * Returns the stored file's id and SHA-256. Used by upload screens from phase 3.
 *
 * Checks, in order: same-origin request (CSRF), valid session, files.upload
 * permission, size, then content type (inside storeFile). Files above 4 MB on
 * Vercel go through /api/files/direct and /api/files/register instead
 * (src/lib/upload-client.ts).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await uploader(request);
  if (user instanceof NextResponse) return user;

  // Refuse oversized bodies before reading them into memory.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > uploadMaxBytes + 64 * 1024) return tooLarge();

  // Count bytes as they arrive, so a body without Content-Length still can't exceed the limit.
  const body = await readBodyWithLimit(request, uploadMaxBytes + 64 * 1024);
  if (body === "too_large") return tooLarge();

  let file: FormDataEntryValue | null;
  try {
    const parsed = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body,
    });
    file = (await parsed.formData()).get("file");
  } catch {
    return NextResponse.json({ error: "Send the file as multipart form data." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Attach the file in a field named "file".' },
      { status: 400 },
    );
  }

  return storeAndRespond(request, user, file.name, new Uint8Array(await file.arrayBuffer()));
}

async function readBodyWithLimit(request: NextRequest, limit: number): Promise<Blob | "too_large"> {
  if (!request.body) return new Blob([]);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[]);
}
