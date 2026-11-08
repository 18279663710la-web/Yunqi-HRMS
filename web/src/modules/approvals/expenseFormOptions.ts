export function normalizeExpenseOptions(values: string[]): string[] | null {
  const options = values.map(value => value.trim());
  if (!options.length || options.length > 50 || options.some(value => !value || value.length > 100) || new Set(options).size !== options.length) return null;
  return options;
}
