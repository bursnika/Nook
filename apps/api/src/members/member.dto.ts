import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';

export class AddMemberDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class UpdateMemberDto {
  @IsEnum(Role)
  role!: Role;
}
