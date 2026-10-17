import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  /** How much the last Google sync brought in; shown in the flash message. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  events?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  tasks?: number;

  @IsOptional()
  @IsIn(['not-granted', 'unavailable'])
  tasksNote?: string;

  /** Set by a redirect after something went wrong (shown as a red banner). */
  @IsOptional()
  @IsString()
  problem?: string;
}
