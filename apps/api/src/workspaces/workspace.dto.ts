import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination.js';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits and single dashes',
  })
  @MaxLength(60)
  slug!: string;
}

export class UpdateWorkspaceDto extends PartialType(CreateWorkspaceDto) {}

export class ListWorkspacesQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  q?: string;
}
