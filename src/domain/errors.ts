/**
 * A rule in CLAUDE.md was broken by the caller, not by the code.
 *
 * These carry a message written for whoever made the call — it says which rule
 * and what to do instead — and become an isError tool result rather than a
 * transport failure.
 */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

/** The thing being written to does not exist. Nothing is ever created implicitly. */
export class NotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFound';
  }
}
