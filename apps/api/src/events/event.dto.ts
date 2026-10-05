import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../common/pagination.js';

export class CreateEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsUUID()
  taskId?: string;
}

export class UpdateEventDto extends PartialType(CreateEventDto) {}

export class ListEventsQuery extends PaginationQuery {
  /** Events that end after this moment. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Events that start before this moment. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @IsString()
  q?: string;
}
