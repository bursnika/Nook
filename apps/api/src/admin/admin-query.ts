import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** `?page=` and `?q=` shared by every list screen. */
export class AdminListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @IsString()
  q?: string;

  /** Set by the redirect after a create/update/delete. */
  @IsOptional()
  @IsString()
  flash?: string;

  /** Set by a redirect after something went wrong (shown as a red banner). */
  @IsOptional()
  @IsString()
  problem?: string;
}
