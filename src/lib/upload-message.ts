/**
 * What to tell someone when /api/files didn't store their file. The route
 * answers its own refusals in JSON; anything else (a crash, a restarting
 * server, a proxy page) used to show only "The file couldn't be uploaded."
 * (QA Tech, Nov 2026), so say what happened and what to do.
 */
export function uploadFailure(status: number, error: string | undefined, name: string): string {
  if (error) return error;
  if (status >= 500) {
    return `The server failed while storing ${name} (error ${status}). Check the app is running, then choose the file again. If it happens again, send the server's log.`;
  }
  return `${name} wasn't uploaded (error ${status}). Choose the file again.`;
}
