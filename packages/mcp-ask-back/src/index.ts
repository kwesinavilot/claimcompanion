export interface MissingField { field: string; priority: number; question: string }
export interface NeedsInput<T> { status: 'needs_input'; summary: string; data: T; missing: MissingField[]; next_question: string }

/** Portable application envelope; does not invoke elicitation, models, or storage. */
export function needsInput<T>(options: { summary: string; data: T; missing: readonly MissingField[] }): NeedsInput<T> {
  if (!options.summary.trim() || !options.missing.length) throw new TypeError('Provide a summary and at least one missing field.');
  const seen = new Set<string>();
  const missing = options.missing.map(item => {
    if (!item.field.trim() || !item.question.trim() || !Number.isFinite(item.priority) || item.priority < 1 || seen.has(item.field)) throw new TypeError('Missing fields need unique names, nonempty questions and positive finite priorities.');
    seen.add(item.field); return { ...item };
  }).sort((a, b) => a.priority - b.priority);
  return { status: 'needs_input', summary: options.summary, data: options.data, missing, next_question: missing[0].question };
}

export function toToolResult<T>(envelope: NeedsInput<T>) {
  return { content: [{ type: 'text' as const, text: envelope.summary }], structuredContent: envelope };
}
