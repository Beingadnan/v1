/** A rule about reports refused the request; safe to show to the person. */
export class ReportsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportsError";
  }
}
