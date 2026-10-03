import { PartialType } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery } from '../common/pagination.js';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  avatarUrl?: string;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

export class ListUsersQuery extends PaginationQuery {
  @IsOptional()
  @IsString()
  q?: string;
}
