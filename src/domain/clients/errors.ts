/** A business rule about clients or equipment refused the request; safe to show. */
export class ClientsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientsError";
  }
}
