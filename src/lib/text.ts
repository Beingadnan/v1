/**
 * A list of IDs for one line of text (an audit summary, a message): the first
 * few and a count, e.g. "T-01, T-02, T-03 and 57 more".
 */
export function shortList(items: readonly string[], max = 8): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} and ${items.length - max} more`;
}
