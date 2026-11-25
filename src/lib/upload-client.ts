/**
 * Sends a file the way the upload screens always have (a FormData with a "file"
 * field), and answers with a Response shaped like POST /api/files.
 *
 * Up to 4 MB the form goes to /api/files as before. Larger files, when the app keeps
 * files in Vercel Blob, go from the browser straight into the store (Vercel functions
 * take at most 4.5 MB per request) and are then checked and registered by
 * /api/files/register. Without Blob (local disk, a VM) /api/files takes them as before.
 */
const DIRECT_FROM_BYTES = 4 * 1024 * 1024;

export async function postFile(body: FormData): Promise<Response> {
  const file = body.get("file");
  if (!(file instanceof File) || file.size <= DIRECT_FROM_BYTES) {
    return fetch("/api/files", { method: "POST", body });
  }

  const probe = await fetch("/api/files/direct", { cache: "no-store" });
  if (probe.status === 401 || probe.status === 403) return probe;
  const info = (await probe.json().catch(() => null)) as {
    enabled?: boolean;
    prefix?: string;
  } | null;
  if (!probe.ok || !info?.enabled || !info.prefix) {
    return fetch("/api/files", { method: "POST", body });
  }

  const pathname = `${info.prefix}${crypto.randomUUID()}`;
  try {
    // Loaded only for large files, so ordinary pages don't carry the Blob client.
    const { upload } = await import("@vercel/blob/client");
    await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/files/direct",
      contentType: "application/octet-stream",
    });
  } catch {
    return Response.json(
      { error: `${file.name} couldn't be uploaded. Check the connection and try again.` },
      { status: 502 },
    );
  }
  return fetch("/api/files/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathname, fileName: file.name }),
  });
}
