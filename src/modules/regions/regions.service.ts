import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { Role } from '@prisma/client';
import { CreateRegionDto } from './core/dto/create-region.dto';
import { UpdateRegionDto } from './core/dto/update-region.dto';
import { AssignRegionAdminDto } from './core/dto/assign-admin.dto';
import { JwtPayload } from '@modules/auth/core/interfaces/jwt-payload.interface';

@Injectable()
export class RegionsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateRegionDto) {
    const existing = await this.prisma.region.findFirst({
      where: {
        OR: [
          { name: { equals: dto.name, mode: 'insensitive' } },
          { code: { equals: dto.code.toUpperCase(), mode: 'insensitive' } },
        ],
      },
    });

    if (existing) {
      throw new ConflictException('Region dengan nama atau kode tersebut sudah terdaftar');
    }

    return this.prisma.region.create({
      data: {
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        description: dto.description?.trim(),
      },
    });
  }

  async findAll(currentUser: JwtPayload) {
    const isSuperAdmin = currentUser.role === Role.SUPER_ADMIN;

    const whereClause = isSuperAdmin
      ? { deleted_at: null }
      : { id: currentUser.region_id || -1, deleted_at: null };

    return this.prisma.region.findMany({
      where: whereClause,
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            biodata: {
              select: {
                first_name: true,
                last_name: true,
                phone: true,
                avatar_url: true,
                role: true,
              },
            },
          },
        },
        _count: {
          select: {
            users: true,
            groups: true,
            communities: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async findOne(id: number, currentUser: JwtPayload) {
    const isSuperAdmin = currentUser.role === Role.SUPER_ADMIN;

    if (!isSuperAdmin && currentUser.region_id !== id) {
      throw new ForbiddenException('Akses ditolak: Anda tidak memiliki wewenang pada Region ini (FR-AUTH-02)');
    }

    const region = await this.prisma.region.findUnique({
      where: { id },
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            biodata: true,
          },
        },
        users: {
          where: { deleted_at: null },
          select: {
            id: true,
            email: true,
            biodata: true,
          },
        },
        groups: {
          where: { deleted_at: null },
          select: {
            id: true,
            name: true,
            description: true,
            _count: { select: { members: true } },
          },
        },
        communities: {
          where: { deleted_at: null },
          select: {
            id: true,
            name: true,
            description: true,
            _count: { select: { members: true, groups: true } },
          },
        },
      },
    });

    if (!region || region.deleted_at) {
      throw new NotFoundException('Region tidak ditemukan');
    }

    return region;
  }

  async update(id: number, dto: UpdateRegionDto) {
    const region = await this.prisma.region.findUnique({ where: { id } });
    if (!region || region.deleted_at) {
      throw new NotFoundException('Region tidak ditemukan');
    }

    if (dto.name && dto.name !== region.name) {
      const duplicate = await this.prisma.region.findFirst({
        where: {
          name: { equals: dto.name, mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (duplicate) {
        throw new ConflictException('Nama Region sudah digunakan');
      }
    }

    return this.prisma.region.update({
      where: { id },
      data: {
        name: dto.name ? dto.name.trim() : undefined,
        description: dto.description !== undefined ? dto.description.trim() : undefined,
      },
    });
  }

  async assignAdmin(regionId: number, dto: AssignRegionAdminDto) {
    const region = await this.prisma.region.findUnique({
      where: { id: regionId },
      include: { admin: true },
    });

    if (!region || region.deleted_at) {
      throw new NotFoundException('Region tidak ditemukan');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: dto.admin_id },
      include: { biodata: true },
    });

    if (!targetUser || targetUser.deleted_at) {
      throw new NotFoundException('Akun pengguna tidak ditemukan');
    }

    const targetRole = targetUser.biodata?.role;
    if (targetRole !== Role.REGION_ADMIN && targetRole !== Role.ADMIN) {
      throw new BadRequestException('Hanya akun dengan role REGION_ADMIN atau ADMIN yang dapat ditugaskan sebagai Admin Region');
    }

    // BR-TENANT-01: Strict 1 Admin per Region.
    // If region already has an admin and it's a different user, unassign the previous admin
    if (region.admin && region.admin.id !== targetUser.id) {
      await this.prisma.user.update({
        where: { id: region.admin.id },
        data: { managed_region_id: null },
      });
    }

    // Also check if targetUser was assigned to another region, update it
    return this.prisma.user.update({
      where: { id: targetUser.id },
      data: {
        region_id: regionId,
        managed_region_id: regionId,
      },
      include: {
        biodata: true,
        managed_region: true,
      },
    });
  }
}
