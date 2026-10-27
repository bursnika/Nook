import { PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination.js';

/** Text fields sent next to the `file` part of the multipart upload. */
export class UploadAttachmentDto {
  @IsOptional()
  @IsUUID()
  pageId?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;
}

export class UpdateAttachmentDto extends PartialType(UploadAttachmentDto) {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename?: string;
}

export class ListAttachmentsQuery extends PaginationQuery {
  @IsOptional()
  @IsUUID()
  pageId?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsString()
  q?: string;
}
