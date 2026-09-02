import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { PasswordUtil } from '@common/utils/password.util';
import { CreateUserDto } from './core/dto/create-user.dto';
import { UpdateUserDto } from './core/dto/update-user.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createUserByAdmin(dto: CreateUserDto) {
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deleted_at: null },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await PasswordUtil.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        biodata: {
          create: {
            first_name: dto.first_name,
            last_name: dto.last_name,
            role: dto.role || Role.USER,
            is_active: true,
          },
        },
      },
      include: {
        biodata: true,
      },
    });

    // Fire notification to newly registered user
    await this.notificationsService.createAndSend({
      userId: user.id,
      type: NotificationType.USER_REGISTERED,
      title: 'Selamat Datang!',
      message: `Akun Anda berhasil didaftarkan oleh Admin. Role Anda: ${user.biodata?.role}`,
      metadata: { registeredUserId: user.id },
    });

    // Also notify all admins
    const admins = await this.prisma.biodata.findMany({
      where: { role: Role.ADMIN },
      select: { user_id: true },
    });

    for (const admin of admins) {
      if (admin.user_id !== user.id) {
        await this.notificationsService.createAndSend({
          userId: admin.user_id,
          type: NotificationType.USER_REGISTERED,
          title: 'User Baru Terdaftar',
          message: `User ${user.email} (${user.biodata?.first_name} ${user.biodata?.last_name}) telah didaftarkan.`,
          metadata: { newUserId: user.id, email: user.email },
        });
      }
    }

    const { password, ...result } = user;
    return result;
  }

  async findAll(includeDeleted = false) {
    return this.prisma.user.findMany({
      where: includeDeleted ? {} : { deleted_at: null },
      select: {
        id: true,
        email: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        biodata: {
          select: {
            first_name: true,
            last_name: true,
            role: true,
            is_active: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, deleted_at: null },
      select: {
        id: true,
        email: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        biodata: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: number, dto: UpdateUserDto) {
    const user = await this.findOne(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        biodata: {
          update: {
            first_name: dto.first_name,
            last_name: dto.last_name,
            role: dto.role,
            is_active: dto.is_active,
          },
        },
      },
      select: {
        id: true,
        email: true,
        updated_at: true,
        biodata: true,
      },
    });

    return updated;
  }

  async softDelete(id: number) {
    await this.findOne(id);

    await this.prisma.user.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        biodata: {
          update: {
            is_active: false,
          },
        },
      },
    });

    return { message: `User with ID ${id} successfully soft-deleted` };
  }
}
