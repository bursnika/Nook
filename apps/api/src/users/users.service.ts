import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './user.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ q, skip, limit }: ListUsersQuery) {
    const where: Prisma.UserWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip, take: limit, orderBy: { id: 'desc' } }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  get(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  create(dto: CreateUserDto) {
    return this.prisma.user.create({ data: dto });
  }

  update(id: string, dto: UpdateUserDto) {
    return this.prisma.user.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
  }
}
