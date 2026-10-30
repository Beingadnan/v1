/** A rule about study data refused the request; safe to show to the person. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}
