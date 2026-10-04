import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination.js';

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be a hex value like #EC4E95' })
  color?: string;
}

export class UpdateTagDto extends PartialType(CreateTagDto) {}

export class ListTagsQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  q?: string;
}
