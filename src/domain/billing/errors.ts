/** A rule about billing refused the request; safe to show to the person. */
export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}
