import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { WorkspaceParams } from '../common/params.js';

export class TaskParams extends WorkspaceParams {
  @IsUUID()
  taskId!: string;
}

export class TaskCommentParams extends TaskParams {
  @IsUUID()
  id!: string;
}

export class TaskCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body!: string;
}
