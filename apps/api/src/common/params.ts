import { IsUUID } from 'class-validator';

export class IdParams {
  @IsUUID()
  id!: string;
}

export class WorkspaceParams {
  @IsUUID()
  workspaceId!: string;
}

export class WorkspaceItemParams extends WorkspaceParams {
  @IsUUID()
  id!: string;
}
