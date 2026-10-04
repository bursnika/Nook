import { PartialType } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsObject, IsOptional } from 'class-validator';
import { BlockType } from '../generated/prisma/enums.js';

export class CreateBlockDto {
  @IsOptional()
  @IsEnum(BlockType)
  type?: BlockType;

  /** Editor payload, e.g. `{ "text": "Hello", "checked": false }`. */
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  /** Omit to append the block after the last one. */
  @IsOptional()
  @IsNumber()
  position?: number;
}

export class UpdateBlockDto extends PartialType(CreateBlockDto) {}
