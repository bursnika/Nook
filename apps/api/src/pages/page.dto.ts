import { OmitType, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../common/pagination.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreatePageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  /** Link to an uploaded image, e.g. `/uploads/<file>` returned by the attachments API. */
  @IsOptional()
  @Matches(/^(https?:\/\/|\/uploads\/)\S+$/, {
    message: 'coverUrl must be an http(s) or /uploads/ link',
  })
  @MaxLength(500)
  coverUrl?: string;

  /** Must be a member of the workspace. Replaced by the signed-in user once auth lands. */
  @IsUUID()
  authorId!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @Matches(SLUG, { message: 'slug must be lowercase letters, digits and single dashes' })
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdatePageDto extends PartialType(OmitType(CreatePageDto, ['authorId'] as const)) {}

export class ListPagesQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  q?: string;

  /** A page id, or `root` for top-level pages. */
  @IsOptional()
  @Matches(/^(root|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, {
    message: 'parentId must be a page id or "root"',
  })
  parentId?: string;
}
