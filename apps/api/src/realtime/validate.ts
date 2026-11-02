import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

export async function validateOrReject<T extends object>(
  cls: new () => T,
  plain: unknown,
): Promise<T> {
  const value = plainToInstance(cls, plain);
  const errors = await validate(value, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    const first = errors[0];
    const detail = first.children?.[0]?.children?.[0] ?? first.children?.[0] ?? first;
    throw new Error(
      Object.values(detail.constraints ?? first.constraints ?? {})[0] ?? 'Invalid message',
    );
  }
  return value;
}
