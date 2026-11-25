/**
 * A response body sent in pieces. Vercel caps a function's response at 4.5 MB
 * unless it is streamed, and a report with its certificate annexes, or a large
 * scan, can be bigger than that.
 */
const CHUNK = 256 * 1024;

export function streamBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + CHUNK, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}
