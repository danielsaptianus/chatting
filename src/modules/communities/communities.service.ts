import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { LinkGroupDto } from './dto/link-group.dto';
import { CommunityRole, GroupRole, NotificationType } from '@prisma/client';

@Injectable()
export class CommunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ==========================================
  // FR-COM-01 & FR-COM-02: CREATE COMMUNITY + ANNOUNCEMENT SUB-GROUP
  // ==========================================
  async createCommunity(userId: number, dto: CreateCommunityDto) {
    const community = await this.prisma.community.create({
      data: {
        name: dto.name,
        description: dto.description,
        created_by_id: userId,
        members: {
          create: {
            user_id: userId,
            role: CommunityRole.COMMUNITY_OWNER,
          },
        },
      },
    });

    // Create default Announcement Sub-Group
    const announcementGroupName = `${dto.name} - Pengumuman`;
    const announcementGroup = await this.prisma.group.create({
      data: {
        name: announcementGroupName,
        description: `Saluran pengumuman resmi untuk komunitas ${dto.name}. Hanya admin yang dapat mengirim pesan.`,
        created_by_id: userId,
        is_announcement: true,
        only_admins_can_post: true,
        members: {
          create: {
            user_id: userId,
            role: GroupRole.OWNER,
          },
        },
      },
    });

    // Link Announcement group to Community
    await this.prisma.communityGroup.create({
      data: {
        community_id: community.id,
        group_id: announcementGroup.id,
        is_announcement: true,
      },
    });

    // Notification to user
    await this.notificationsService.createAndSend({
      userId,
      type: NotificationType.COMMUNITY_CREATED,
      title: 'Komunitas Dibuat',
      message: `Komunitas "${community.name}" berhasil dibuat dengan sub-grup pengumuman default.`,
      metadata: { communityId: community.id, announcementGroupId: announcementGroup.id },
    });

    return this.getCommunityDetails(community.id, userId);
  }

  // ==========================================
  // GET USER COMMUNITIES
  // ==========================================
  async getMyCommunities(userId: number) {
    return this.prisma.community.findMany({
      where: {
        deleted_at: null,
        members: {
          some: { user_id: userId },
        },
      },
      include: {
        creator: {
          select: { id: true, email: true, biodata: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, email: true, biodata: true },
            },
          },
        },
        groups: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
                description: true,
                is_announcement: true,
                only_admins_can_post: true,
                _count: { select: { members: true } },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ==========================================
  // GET COMMUNITY DETAILS
  // ==========================================
  async getCommunityDetails(communityId: number, userId: number) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deleted_at: null },
      include: {
        creator: {
          select: { id: true, email: true, biodata: true },
        },
        members: {
          include: {
            user: {
              select: { id: true, email: true, biodata: true },
            },
          },
        },
        groups: {
          include: {
            group: {
              select: {
                id: true,
                name: true,
                description: true,
                is_announcement: true,
                only_admins_can_post: true,
                _count: { select: { members: true } },
                members: {
                  where: { user_id: userId },
                  select: { role: true },
                },
              },
            },
          },
        },
      },
    });

    if (!community) {
      throw new NotFoundException('Komunitas tidak ditemukan');
    }

    const currentMember = community.members.find((m) => m.user_id === userId);
    return {
      ...community,
      currentUserRole: currentMember?.role || null,
      isMember: !!currentMember,
      isAdmin: currentMember?.role === CommunityRole.COMMUNITY_OWNER || currentMember?.role === CommunityRole.COMMUNITY_ADMIN,
    };
  }

  // ==========================================
  // JOIN COMMUNITY
  // ==========================================
  async joinCommunity(communityId: number, userId: number) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deleted_at: null },
      include: {
        members: { where: { user_id: userId } },
        groups: { where: { is_announcement: true } },
      },
    });

    if (!community) {
      throw new NotFoundException('Komunitas tidak ditemukan');
    }

    if (community.members.length > 0) {
      return { message: 'Anda sudah menjadi anggota komunitas ini.' };
    }

    // Add to community
    await this.prisma.communityMember.create({
      data: {
        community_id: communityId,
        user_id: userId,
        role: CommunityRole.COMMUNITY_MEMBER,
      },
    });

    // Automatically add to Announcement group
    const announcementGroup = community.groups[0];
    if (announcementGroup) {
      await this.prisma.groupMember.upsert({
        where: {
          group_id_user_id: {
            group_id: announcementGroup.group_id,
            user_id: userId,
          },
        },
        create: {
          group_id: announcementGroup.group_id,
          user_id: userId,
          role: GroupRole.MEMBER,
        },
        update: {},
      });
    }

    await this.notificationsService.createAndSend({
      userId,
      type: NotificationType.COMMUNITY_MEMBER_ADDED,
      title: 'Bergabung ke Komunitas',
      message: `Anda telah berhasil bergabung ke komunitas "${community.name}".`,
      metadata: { communityId },
    });

    return this.getCommunityDetails(communityId, userId);
  }

  // ==========================================
  // FR-COM-03: LINK GROUP TO COMMUNITY
  // ==========================================
  async linkGroup(communityId: number, userId: number, dto: LinkGroupDto) {
    // 1. Verify community and check requester is Community Owner or Admin
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deleted_at: null },
      include: {
        members: { where: { user_id: userId } },
      },
    });

    if (!community) {
      throw new NotFoundException('Komunitas tidak ditemukan');
    }

    const commRole = community.members[0]?.role;
    if (commRole !== CommunityRole.COMMUNITY_OWNER && commRole !== CommunityRole.COMMUNITY_ADMIN) {
      throw new ForbiddenException('Hanya Owner atau Admin komunitas yang dapat menautkan grup.');
    }

    // 2. Verify requester manages the group (is OWNER or ADMIN of the group)
    const groupMember = await this.prisma.groupMember.findFirst({
      where: {
        group_id: dto.groupId,
        user_id: userId,
        role: { in: [GroupRole.OWNER, GroupRole.ADMIN] },
      },
      include: { group: true },
    });

    if (!groupMember) {
      throw new ForbiddenException('Anda harus menjadi Owner atau Admin dari grup tersebut untuk menautkannya.');
    }

    // 3. Check if already linked
    const existing = await this.prisma.communityGroup.findFirst({
      where: { group_id: dto.groupId },
    });

    if (existing) {
      if (existing.community_id === communityId) {
        throw new BadRequestException('Grup ini sudah ditautkan ke komunitas ini.');
      } else {
        throw new BadRequestException('Grup ini sudah ditautkan ke komunitas lain.');
      }
    }

    // 4. Link group
    const linked = await this.prisma.communityGroup.create({
      data: {
        community_id: communityId,
        group_id: dto.groupId,
        is_announcement: false,
      },
    });

    return {
      message: `Grup "${groupMember.group.name}" berhasil ditautkan ke komunitas "${community.name}".`,
      linked,
    };
  }

  // ==========================================
  // FR-COM-04: GET COMMUNITY SUB-GROUPS
  // ==========================================
  async getCommunityGroups(communityId: number, userId: number) {
    // User must be a member of the community to view sub-groups
    const member = await this.prisma.communityMember.findFirst({
      where: { community_id: communityId, user_id: userId },
    });

    if (!member) {
      throw new ForbiddenException('Anda harus menjadi anggota komunitas untuk melihat daftar sub-grup.');
    }

    const communityGroups = await this.prisma.communityGroup.findMany({
      where: { community_id: communityId },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            description: true,
            is_announcement: true,
            only_admins_can_post: true,
            _count: { select: { members: true } },
            members: {
              where: { user_id: userId },
              select: { role: true },
            },
          },
        },
      },
      orderBy: [{ is_announcement: 'desc' }, { added_at: 'asc' }],
    });

    return communityGroups.map((cg) => ({
      id: cg.id,
      groupId: cg.group.id,
      name: cg.group.name,
      description: cg.group.description,
      isAnnouncement: cg.is_announcement,
      onlyAdminsCanPost: cg.group.only_admins_can_post,
      memberCount: cg.group._count.members,
      isUserMember: cg.group.members.length > 0,
      userRole: cg.group.members[0]?.role || null,
    }));
  }

  // ==========================================
  // FR-COM-05: REMOVE MEMBER FROM COMMUNITY & ALL LINKED SUB-GROUPS
  // ==========================================
  async removeMember(communityId: number, adminUserId: number, targetUserId: number) {
    const community = await this.prisma.community.findFirst({
      where: { id: communityId, deleted_at: null },
      include: {
        members: true,
        groups: true,
      },
    });

    if (!community) {
      throw new NotFoundException('Komunitas tidak ditemukan');
    }

    const adminMember = community.members.find((m) => m.user_id === adminUserId);
    if (!adminMember || (adminMember.role !== CommunityRole.COMMUNITY_OWNER && adminMember.role !== CommunityRole.COMMUNITY_ADMIN)) {
      throw new ForbiddenException('Hanya pengurus komunitas yang dapat mengeluarkan anggota.');
    }

    const targetMember = community.members.find((m) => m.user_id === targetUserId);
    if (!targetMember) {
      throw new NotFoundException('Anggota tidak ditemukan di komunitas ini.');
    }

    if (targetMember.role === CommunityRole.COMMUNITY_OWNER) {
      throw new ForbiddenException('Tidak dapat mengeluarkan Owner komunitas.');
    }

    if (adminMember.role === CommunityRole.COMMUNITY_ADMIN && targetMember.role === CommunityRole.COMMUNITY_ADMIN) {
      throw new ForbiddenException('Admin komunitas tidak dapat mengeluarkan sesama Admin.');
    }

    // 1. Remove from Community
    await this.prisma.communityMember.delete({
      where: {
        community_id_user_id: {
          community_id: communityId,
          user_id: targetUserId,
        },
      },
    });

    // 2. Cascade remove from all sub-groups in this community
    const groupIds = community.groups.map((g) => g.group_id);
    if (groupIds.length > 0) {
      await this.prisma.groupMember.deleteMany({
        where: {
          group_id: { in: groupIds },
          user_id: targetUserId,
        },
      });
    }

    // 3. Notify the target user
    await this.notificationsService.createAndSend({
      userId: targetUserId,
      type: NotificationType.COMMUNITY_MEMBER_REMOVED,
      title: 'Dikeluarkan dari Komunitas',
      message: `Anda telah dikeluarkan dari komunitas "${community.name}" beserta seluruh sub-grupnya.`,
      metadata: { communityId, communityName: community.name },
    });

    return {
      message: `Anggota berhasil dikeluarkan dari komunitas "${community.name}" dan ${groupIds.length} sub-grup terkait.`,
    };
  }
}
