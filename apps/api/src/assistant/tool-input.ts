/** The model's tool input is untrusted JSON: every field is checked here before a service sees it. */
export class ToolInputError extends Error {}

type Fields = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Unknown keys (a made-up `workspaceId`, say) are simply never read. */
export function asFields(input: unknown): Fields {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ToolInputError('The tool input must be a JSON object');
  }
  return input as Fields;
}

export function optString(fields: Fields, key: string, max: number): string | undefined {
  const value = fields[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" must be a string`);
  if (value.length > max) throw new ToolInputError(`"${key}" is longer than ${max} characters`);
  return value;
}

export function reqString(fields: Fields, key: string, max: number): string {
  const value = optString(fields, key, max);
  if (value === undefined || value.trim() === '') {
    throw new ToolInputError(`"${key}" is required`);
  }
  return value;
}

export function optEnum<T extends string>(
  fields: Fields,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = fields[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ToolInputError(`"${key}" must be one of: ${values.join(', ')}`);
  }
  return value as T;
}

export function optDate(fields: Fields, key: string): Date | undefined {
  const value = fields[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" must be an ISO 8601 date`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ToolInputError(
      `"${key}" must be an ISO 8601 date, e.g. 2026-11-05 or 2026-11-05T10:00:00Z`,
    );
  }
  return date;
}

export function reqDate(fields: Fields, key: string): Date {
  const date = optDate(fields, key);
  if (!date) throw new ToolInputError(`"${key}" is required`);
  return date;
}

export function reqUuid(fields: Fields, key: string): string {
  const value = fields[key];
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ToolInputError(`"${key}" must be an id taken from a previous tool result`);
  }
  return value;
}
