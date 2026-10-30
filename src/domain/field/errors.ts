/** A rule about field work refused the request; safe to show to the person. */
export class FieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldError";
  }
}
