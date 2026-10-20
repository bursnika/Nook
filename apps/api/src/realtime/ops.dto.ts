import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BlockType } from '../generated/prisma/enums.js';

export const OP_TYPES = ['insert', 'update', 'move', 'delete'] as const;
export type OpType = (typeof OP_TYPES)[number];

/**
 * One change of one block. The client picks the block id on insert, so it can show the block at once and
 * later changes can refer to it before the server has answered.
 *  - insert: id, position, optional blockType and content
 *  - update: id and the parts that changed (last writer wins per block)
 *  - move:   id and the new fractional position
 *  - delete: id
 */
export class BlockOpDto {
  @IsIn(OP_TYPES)
  type!: OpType;

  @IsUUID()
  id!: string;

  @IsOptional()
  @IsEnum(BlockType)
  blockType?: BlockType;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  position?: number;
}

export class ApplyOpsDto {
  /** A random id per browser tab, so a tab can tell its own echo from other people's changes. */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BlockOpDto)
  ops!: BlockOpDto[];
}

export class PresenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  clientId!: string;

  /** The block the cursor is in; null when the person left the editor. */
  @IsOptional()
  @IsUUID()
  blockId?: string | null;

  /** Caret offset inside the block text. */
  @IsOptional()
  @IsNumber()
  caret?: number;
}

export class SinceQuery {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  since?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientId?: string;

  /** Long poll only: how long the server may hold the request, in seconds. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  timeout?: number;
}

/** What travels to other tabs: the batch, who sent it and where it sits in the log. */
export interface OpsMessage {
  type: 'ops';
  seq: number;
  clientId: string;
  authorId: string;
  at: string;
  ops: BlockOpDto[];
}

export interface PresenceMessage {
  type: 'presence';
  clientId: string;
  userId: string;
  name: string;
  blockId: string | null;
  caret: number | null;
  at: string;
}

export interface LeaveMessage {
  type: 'leave';
  clientId: string;
}

export type PageMessage = OpsMessage | PresenceMessage | LeaveMessage;
