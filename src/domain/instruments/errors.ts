/** A rule about instruments or certificates refused the request; safe to show. */
export class InstrumentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstrumentsError";
  }
}
