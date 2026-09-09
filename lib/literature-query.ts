/** Bound generated prose before it reaches the existing research API contract. */
export function boundLiteratureQuery(query: string): string {
  return query.slice(0, 500)
}
