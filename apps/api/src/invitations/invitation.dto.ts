import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '../generated/prisma/enums.js';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  /** Owners cannot be invited; promote an existing member instead. */
  @IsOptional()
  @IsIn([Role.MEMBER, Role.ADMIN])
  role?: Role;
}

export class AcceptInvitationDto {
  @IsString()
  @MinLength(20)
  token!: string;
}
