import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AdminListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['note', 'checklist', 'tasks', 'files'])
  tab?: string;

  @IsOptional()
  @IsString()
  flash?: string;

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

  @IsOptional()
  @IsString()
  problem?: string;
}
