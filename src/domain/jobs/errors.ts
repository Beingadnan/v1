/** A rule about jobs refused the request; safe to show to the person. */
export class JobsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobsError";
  }
}
