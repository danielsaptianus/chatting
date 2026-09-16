import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '@common/prisma/prisma.service';
import { PasswordUtil } from '@common/utils/password.util';
import { CreateUserDto } from './core/dto/create-user.dto';
import { UpdateUserDto } from './core/dto/update-user.dto';
import { UploadedAvatarFile } from './core/interfaces/avatar-file.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, Role, GroupRole } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly avatarDir = path.join(process.cwd(), 'public', 'uploads', 'avatars');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {
    // Ensure avatar directory exists
    if (!fs.existsSync(this.avatarDir)) {
      fs.mkdirSync(this.avatarDir, { recursive: true });
    }
  }

  // =========================================================================
  // MULTI-ROLE & SCOPED USER CREATION (BR-ROLE-01, FR-ROLE-01 - FR-ROLE-04)
  // =========================================================================

  async createUser(creatorUser: any, dto: CreateUserDto) {
    const creatorRole: Role = creatorUser?.role || creatorUser?.biodata?.role;

    // Check email existence
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deleted_at: null },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    let targetRole: Role = dto.role || Role.USER;
    let targetManagedGroupId: number | null = null;
    let targetManagedRegionId: number | null = null;
    let targetRegionId: number | null = null;
    let enrollGroupId: number | null = null;

    if (creatorRole === Role.SUPER_ADMIN) {
      // Super Admin:
      // - If creating REGION_ADMIN (or ADMIN)
      if (targetRole === Role.REGION_ADMIN || targetRole === Role.ADMIN) {
        if (dto.managed_region_id) {
          const region = await this.prisma.region.findFirst({
            where: { id: Number(dto.managed_region_id), deleted_at: null },
            include: { admin: true },
          });

          if (!region) {
            throw new NotFoundException(`Region dengan ID ${dto.managed_region_id} tidak ditemukan.`);
          }

          // BR-TENANT-01: Strict 1 Admin per Region
          if (region.admin) {
            throw new BadRequestException(
              `Region "${region.name}" sudah memiliki Admin (${region.admin.email}). Setiap Region hanya boleh memiliki 1 Admin (BR-TENANT-01).`,
            );
          }

          targetManagedRegionId = Number(dto.managed_region_id);
          targetRegionId = targetManagedRegionId;
        } else if (dto.managed_group_id) {
          // Legacy group admin support
          const group = await this.prisma.group.findFirst({
            where: { id: Number(dto.managed_group_id), deleted_at: null },
          });
          if (!group) {
            throw new NotFoundException(`Grup dengan ID ${dto.managed_group_id} tidak ditemukan.`);
          }
          targetManagedGroupId = Number(dto.managed_group_id);
          enrollGroupId = targetManagedGroupId;
        }
      } else if (targetRole === Role.USER) {
        // Super Admin creating USER: can assign region or group
        if (dto.region_id) {
          const region = await this.prisma.region.findFirst({
            where: { id: Number(dto.region_id), deleted_at: null },
          });
          if (!region) {
            throw new NotFoundException(`Region dengan ID ${dto.region_id} tidak ditemukan.`);
          }
          targetRegionId = Number(dto.region_id);
        }
        if (dto.group_id) {
          const group = await this.prisma.group.findFirst({
            where: { id: Number(dto.group_id), deleted_at: null },
          });
          if (!group) {
            throw new NotFoundException(`Grup dengan ID ${dto.group_id} tidak ditemukan.`);
          }
          enrollGroupId = Number(dto.group_id);
          if (!targetRegionId && group.region_id) {
            targetRegionId = group.region_id;
          }
        }
      }
    } else if (creatorRole === Role.REGION_ADMIN || creatorRole === Role.ADMIN) {
      // Region Admin / Group Admin (FR-USER-01, FR-USER-02, BR-TENANT-01, BR-TENANT-02):
      // - Can ONLY create USER
      if (dto.role && dto.role !== Role.USER) {
        throw new ForbiddenException(
          'Admin Region hanya berhak membuat akun baru dengan peran USER (FR-USER-01).',
        );
      }
      targetRole = Role.USER;

      const adminRegionId = creatorUser.managed_region_id || creatorUser.region_id;
      const adminGroupId = creatorUser.managed_group_id;

      if (adminRegionId) {
        // Enforce region scoping
        if (dto.region_id && Number(dto.region_id) !== Number(adminRegionId)) {
          throw new ForbiddenException(
            'Proteksi Lintas Region: Dilarang mendaftarkan pengguna ke luar region wewenang Anda (FR-USER-02, BR-TENANT-02).',
          );
        }
        targetRegionId = Number(adminRegionId);
      } else if (adminGroupId) {
        // Fallback for legacy group-scoped admin
        if (dto.group_id && Number(dto.group_id) !== Number(adminGroupId)) {
          throw new ForbiddenException(
            'Proteksi Lintas Grup: Dilarang mendaftarkan pengguna ke luar grup wewenang Anda.',
          );
        }
        enrollGroupId = Number(adminGroupId);
      } else {
        throw new BadRequestException('Akun Admin Anda belum memiliki Region atau Grup wewenang.');
      }
    } else {
      throw new ForbiddenException(
        'Hanya Super Admin atau Admin Region yang dapat mendaftarkan pengguna baru.',
      );
    }

    const hashedPassword = await PasswordUtil.hash(dto.password);

    // Create user with biodata and region relations
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        region_id: targetRegionId,
        managed_region_id: targetManagedRegionId,
        managed_group_id: targetManagedGroupId,
        biodata: {
          create: {
            first_name: dto.first_name,
            last_name: dto.last_name,
            bio: dto.bio || null,
            phone: dto.phone || null,
            role: targetRole,
            is_active: true,
          },
        },
      },
      include: {
        biodata: true,
        region: { select: { id: true, name: true, code: true } },
        managed_region: { select: { id: true, name: true, code: true } },
        managed_group: { select: { id: true, name: true } },
      },
    });

    // Auto-enroll user into target group if applicable
    if (enrollGroupId) {
      const memberRole = targetRole === Role.ADMIN ? GroupRole.ADMIN : GroupRole.MEMBER;
      await this.prisma.groupMember.upsert({
        where: {
          group_id_user_id: {
            group_id: enrollGroupId,
            user_id: user.id,
          },
        },
        create: {
          group_id: enrollGroupId,
          user_id: user.id,
          role: memberRole,
        },
        update: {
          role: memberRole,
        },
      });
    }

    // Fire welcome notification
    await this.notificationsService.createAndSend({
      userId: user.id,
      type: NotificationType.USER_REGISTERED,
      title: 'Selamat Datang di ChatSphere!',
      message: `Akun Anda telah dibuat. Peran Anda: ${user.biodata?.role}${
        enrollGroupId ? ` (Terdaftar pada grup #${enrollGroupId})` : ''
      }`,
      metadata: { registeredUserId: user.id, role: targetRole },
    });

    const { password, ...result } = user;
    return result;
  }

  // =========================================================================
  // USER LIST & LOOKUP
  // =========================================================================

  async findAll(currentUser: any, includeDeleted = false) {
    const role: Role = currentUser?.role || currentUser?.biodata?.role;

    // Super Admin sees all users
    if (role === Role.SUPER_ADMIN) {
      return this.prisma.user.findMany({
        where: includeDeleted ? {} : { deleted_at: null },
        select: {
          id: true,
          email: true,
          region_id: true,
          managed_region_id: true,
          managed_group_id: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          biodata: true,
          region: { select: { id: true, name: true, code: true } },
          managed_region: { select: { id: true, name: true, code: true } },
          managed_group: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
      });
    }

    // Region Admin sees users in their region
    const userRegionId = currentUser.managed_region_id || currentUser.region_id;
    if (userRegionId) {
      return this.prisma.user.findMany({
        where: {
          region_id: userRegionId,
          ...(includeDeleted ? {} : { deleted_at: null }),
        },
        select: {
          id: true,
          email: true,
          region_id: true,
          managed_region_id: true,
          managed_group_id: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          biodata: true,
          region: { select: { id: true, name: true, code: true } },
          managed_region: { select: { id: true, name: true, code: true } },
          managed_group: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
      });
    }

    // Legacy Group Admin sees users in their managed group + themselves
    if (role === Role.ADMIN && currentUser.managed_group_id) {
      const groupMembers = await this.prisma.groupMember.findMany({
        where: { group_id: currentUser.managed_group_id },
        select: { user_id: true },
      });
      const userIds = groupMembers.map((gm) => gm.user_id);
      if (!userIds.includes(currentUser.userId)) {
        userIds.push(currentUser.userId);
      }

      return this.prisma.user.findMany({
        where: {
          id: { in: userIds },
          ...(includeDeleted ? {} : { deleted_at: null }),
        },
        select: {
          id: true,
          email: true,
          region_id: true,
          managed_region_id: true,
          managed_group_id: true,
          created_at: true,
          updated_at: true,
          deleted_at: true,
          biodata: true,
          region: { select: { id: true, name: true, code: true } },
          managed_region: { select: { id: true, name: true, code: true } },
          managed_group: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
      });
    }

    // Regular users see active users in their region
    return this.prisma.user.findMany({
      where: {
        deleted_at: null,
        ...(currentUser?.region_id ? { region_id: currentUser.region_id } : {}),
      },
      select: {
        id: true,
        email: true,
        region_id: true,
        created_at: true,
        biodata: {
          select: {
            first_name: true,
            last_name: true,
            avatar_url: true,
            bio: true,
            role: true,
          },
        },
        region: { select: { id: true, name: true, code: true } },
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
        region_id: true,
        managed_region_id: true,
        managed_group_id: true,
        created_at: true,
        updated_at: true,
        deleted_at: true,
        biodata: true,
        region: { select: { id: true, name: true, code: true } },
        managed_region: { select: { id: true, name: true, code: true } },
        managed_group: { select: { id: true, name: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  // =========================================================================
  // PUBLIC PROFILE CARD (FR-BIO-04, FR-USER-02)
  // =========================================================================

  async getPublicProfile(id: number, currentUser?: any) {
    const user = await this.prisma.user.findFirst({
      where: { id, deleted_at: null },
      select: {
        id: true,
        region_id: true,
        created_at: true,
        biodata: {
          select: {
            first_name: true,
            last_name: true,
            bio: true,
            avatar_url: true,
            role: true,
          },
        },
        region: { select: { id: true, name: true, code: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User profile not found');
    }

    // FR-USER-02, BR-TENANT-02: Prevent cross-region profile inspection
    const callerRole: Role = currentUser?.role || currentUser?.biodata?.role;
    if (callerRole && callerRole !== Role.SUPER_ADMIN && currentUser.region_id && user.region_id) {
      if (Number(currentUser.region_id) !== Number(user.region_id)) {
        throw new ForbiddenException(
          'Proteksi Lintas Region: Profil pengguna berada di luar wilayah/region Anda (FR-USER-02, BR-TENANT-02)',
        );
      }
    }

    return {
      id: user.id,
      first_name: user.biodata?.first_name || '',
      last_name: user.biodata?.last_name || '',
      bio: user.biodata?.bio || 'Tidak ada bio.',
      avatar_url: user.biodata?.avatar_url || null,
      role: user.biodata?.role || Role.USER,
      region: user.region,
      member_since: user.created_at,
    };
  }

  // =========================================================================
  // UPDATE USER & PROFILE (FR-BIO-01)
  // =========================================================================

  async update(currentUser: any, id: number, dto: UpdateUserDto) {
    const callerRole: Role = currentUser.role || currentUser.biodata?.role;

    // Self, Super Admin, or Group Admin for their members
    if (callerRole !== Role.SUPER_ADMIN && currentUser.userId !== id) {
      if (callerRole === Role.ADMIN && currentUser.managed_group_id) {
        const isMember = await this.prisma.groupMember.findUnique({
          where: {
            group_id_user_id: {
              group_id: currentUser.managed_group_id,
              user_id: id,
            },
          },
        });
        if (!isMember) {
          throw new ForbiddenException(
            'Proteksi Lintas Grup: Anda hanya dapat memperbarui data anggota di grup Anda.',
          );
        }
      } else {
        throw new ForbiddenException('You can only update your own profile');
      }
    }

    // Only Super Admin can change managed_group_id or role to ADMIN/SUPER_ADMIN
    const userUpdateData: any = {};
    if (dto.managed_group_id !== undefined && callerRole === Role.SUPER_ADMIN) {
      userUpdateData.managed_group_id = dto.managed_group_id;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...userUpdateData,
        biodata: {
          update: {
            first_name: dto.first_name,
            last_name: dto.last_name,
            bio: dto.bio,
            phone: dto.phone,
            ...(callerRole === Role.SUPER_ADMIN && dto.role ? { role: dto.role } : {}),
            ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
          },
        },
      },
      select: {
        id: true,
        email: true,
        managed_group_id: true,
        updated_at: true,
        biodata: true,
      },
    });

    return updated;
  }

  // =========================================================================
  // AVATAR UPLOAD & DELETE (FR-BIO-02, FR-BIO-03, BR-AVATAR-01)
  // =========================================================================

  async updateAvatar(userId: number, file: UploadedAvatarFile) {
    if (!file) {
      throw new BadRequestException('File avatar tidak boleh kosong.');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
      include: { biodata: true },
    });

    if (!user) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }

    // Delete existing old avatar file if present
    if (user.biodata?.avatar_url) {
      this.removeAvatarFile(user.biodata.avatar_url);
    }

    // Generate unique filename
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `avatar-${userId}-${Date.now()}${ext}`;
    const targetPath = path.join(this.avatarDir, filename);

    // Write file to disk
    await fs.promises.writeFile(targetPath, file.buffer);

    const relativeUrl = `/uploads/avatars/${filename}`;

    const updated = await this.prisma.biodata.update({
      where: { user_id: userId },
      data: { avatar_url: relativeUrl },
    });

    return {
      message: 'Foto profil berhasil diperbarui',
      avatar_url: updated.avatar_url,
    };
  }

  async deleteAvatar(userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
      include: { biodata: true },
    });

    if (!user) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }

    if (user.biodata?.avatar_url) {
      this.removeAvatarFile(user.biodata.avatar_url);
    }

    await this.prisma.biodata.update({
      where: { user_id: userId },
      data: { avatar_url: null },
    });

    return {
      message: 'Foto profil berhasil dihapus dan dikembalikan ke inisial standar.',
      avatar_url: null,
    };
  }

  private removeAvatarFile(avatarUrl: string) {
    try {
      const filename = path.basename(avatarUrl);
      const filePath = path.join(this.avatarDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn('Failed to delete old avatar file:', err);
    }
  }

  // =========================================================================
  // ISOLATED SOFT DELETE (FR-ROLE-05)
  // =========================================================================

  async softDelete(currentUser: any, targetUserId: number) {
    const callerRole: Role = currentUser.role || currentUser.biodata?.role;
    const target = await this.findOne(targetUserId);

    if (callerRole === Role.SUPER_ADMIN) {
      // Super Admin can soft-delete any user
    } else if (callerRole === Role.REGION_ADMIN || callerRole === Role.ADMIN) {
      if (target.biodata?.role === Role.SUPER_ADMIN) {
        throw new ForbiddenException('Dilarang menonaktifkan akun Super Admin.');
      }

      const adminRegionId = currentUser.managed_region_id || currentUser.region_id;
      if (adminRegionId) {
        if (target.biodata?.role === Role.REGION_ADMIN || target.biodata?.role === Role.ADMIN) {
          throw new ForbiddenException('Dilarang menonaktifkan akun Admin lain.');
        }
        if (Number(target.region_id) !== Number(adminRegionId)) {
          throw new ForbiddenException(
            'Proteksi Lintas Region: Anda hanya dapat menonaktifkan pengguna di dalam region wewenang Anda (FR-USER-02, BR-TENANT-02).',
          );
        }
      } else if (currentUser.managed_group_id) {
        // Fallback: Group Admin can only soft-delete user in their managed group (FR-ROLE-05)
        const adminGroupId = currentUser.managed_group_id;
        const isMember = await this.prisma.groupMember.findUnique({
          where: {
            group_id_user_id: {
              group_id: adminGroupId,
              user_id: targetUserId,
            },
          },
        });

        if (!isMember) {
          throw new ForbiddenException(
            'Proteksi Lintas Grup: Anda hanya dapat menonaktifkan pengguna di dalam grup yang Anda kelola.',
          );
        }
      }
    } else {
      throw new ForbiddenException('Akses ditolak: Hanya admin yang dapat menonaktifkan pengguna.');
    }

    await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        deleted_at: new Date(),
        biodata: {
          update: {
            is_active: false,
          },
        },
      },
    });

    return { message: `User with ID ${targetUserId} successfully soft-deleted` };
  }
}
