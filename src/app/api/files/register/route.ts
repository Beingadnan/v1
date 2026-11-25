import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { uploadMaxBytes } from "@/lib/storage";
import { isOwnIncoming, takeIncoming } from "@/lib/storage/incoming";
import { storeAndRespond, tooLarge, uploader } from "@/lib/storage/upload-route";

const input = z.object({ pathname: z.string().max(200), fileName: z.string().max(1000) });

/**
 * POST /api/files/register {pathname, fileName} — takes a file the browser put in
 * Vercel Blob through /api/files/direct, checks it exactly like POST /api/files
 * (size, content type, hash), stores it content-addressed and answers the same way.
 * The incoming copy is deleted either way.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await uploader(request);
  if (user instanceof NextResponse) return user;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "Direct uploads are off." }, { status: 404 });

  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !isOwnIncoming(parsed.data.pathname, user.id)) {
    return NextResponse.json({ error: "That upload can't be found." }, { status: 400 });
  }
  const taken = await takeIncoming(token, parsed.data.pathname, uploadMaxBytes);
  if (!taken.ok) {
    return taken.reason === "too_large"
      ? tooLarge()
      : NextResponse.json({ error: "The upload didn't arrive. Try again." }, { status: 404 });
  }
  return storeAndRespond(request, user, parsed.data.fileName, taken.bytes);
}
