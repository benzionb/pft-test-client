/**
 * Validates that a value is a non-empty string (after trimming).
 * Returns the trimmed value.
 */
export function requireNonEmpty(value: string | undefined, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

/**
 * Parses a string as a number and validates it meets minimum requirements.
 */
export function parseNumberOption(value: string, label: string, min = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`${label} must be a number >= ${min}`);
  }
  return parsed;
}
