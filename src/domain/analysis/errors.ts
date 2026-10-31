/** A rule about analysis or deviations refused the request; safe to show to the person. */
export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisError";
  }
}
