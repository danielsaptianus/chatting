import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { CreateGroupDto } from './dto/create-group.dto';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { SendDirectMessageDto } from './dto/send-direct-message.dto';
import { GroupRole, NotificationType, JoinRequestStatus, Role } from '@prisma/client';

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly gateway: NotificationsGateway,
  ) {}

  // ====================================================================
  // GROUP CHAT
  // ====================================================================

  async createGroup(userId: number, dto: CreateGroupDto) {
    const inviteCode = 'inv_' + crypto.randomBytes(5).toString('hex');
    const group = await this.prisma.group.create({
      data: {
        name: dto.name,
        description: dto.description,
        invite_code: inviteCode,
        created_by_id: userId,
        members: {
          create: {
            user_id: userId,
            role: GroupRole.OWNER,
          },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, email: true, biodata: true },
            },
          },
        },
      },
    });

    return group;
  }

  async getMyGroups(userId: number) {
    return this.prisma.group.findMany({
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
      },
    });
  }

  async getAllGroups(userId?: number) {
    if (userId) {
      const user = await this.prisma.biodata.findUnique({ where: { user_id: userId } });
      if (user?.role !== Role.ADMIN) {
        throw new ForbiddenException('Daftar seluruh grup hanya dapat diakses oleh Administrator');
      }
    }
    return this.prisma.group.findMany({
      where: {
        deleted_at: null,
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
        join_requests: {
          where: { status: JoinRequestStatus.PENDING },
          select: { id: true, user_id: true, status: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async addMember(currentUserId: number, groupId: number, dto: AddGroupMemberDto) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // Check if requester is owner/admin of group or system admin (WhatsApp rule)
    const requesterMember = group.members.find((m) => m.user_id === currentUserId);
    const currentUser = await this.prisma.biodata.findUnique({
      where: { user_id: currentUserId },
    });
    const isStaff = requesterMember && (requesterMember.role === GroupRole.OWNER || requesterMember.role === GroupRole.ADMIN);
    const isSystemAdmin = currentUser?.role === Role.ADMIN;
    if (!isStaff && !isSystemAdmin) {
      throw new ForbiddenException('Hanya admin atau owner grup yang dapat menambahkan anggota');
    }

    // Check if target is already in group
    const alreadyMember = group.members.some((m) => m.user_id === dto.userId);
    if (alreadyMember) {
      throw new BadRequestException('User is already a member of this group');
    }

    const member = await this.prisma.groupMember.create({
      data: {
        group_id: groupId,
        user_id: dto.userId,
        role: GroupRole.MEMBER,
      },
      include: {
        user: { select: { id: true, email: true, biodata: true } },
      },
    });

    // Fire notification: "notif bahwa telah ditambahkan ke grup ini"
    await this.notificationsService.createAndSend({
      userId: dto.userId,
      type: NotificationType.ADDED_TO_GROUP,
      title: 'Ditambahkan ke Grup',
      message: `Anda telah ditambahkan ke dalam grup "${group.name}".`,
      metadata: { groupId: group.id, groupName: group.name },
    });

    return member;
  }

  async requestJoinGroup(userId: number, groupId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: {
        members: true,
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const isMember = group.members.some((m) => m.user_id === userId);
    if (isMember) {
      throw new BadRequestException('You are already a member of this group');
    }

    const existingPending = await this.prisma.groupJoinRequest.findFirst({
      where: {
        group_id: groupId,
        user_id: userId,
        status: JoinRequestStatus.PENDING,
      },
    });

    if (existingPending) {
      throw new BadRequestException('Permintaan bergabung Anda sedang menunggu persetujuan admin/owner');
    }

    const joinRequest = await this.prisma.groupJoinRequest.upsert({
      where: {
        group_id_user_id: { group_id: groupId, user_id: userId },
      },
      update: {
        status: JoinRequestStatus.PENDING,
      },
      create: {
        group_id: groupId,
        user_id: userId,
        status: JoinRequestStatus.PENDING,
      },
      include: {
        user: { select: { id: true, email: true, biodata: true } },
      },
    });

    const requesterName = joinRequest.user?.biodata
      ? `${joinRequest.user.biodata.first_name} ${joinRequest.user.biodata.last_name}`
      : joinRequest.user.email;

    // Send notification to group owner and admin(s)
    await this.notificationsService.createForGroupStaff(groupId, {
      type: NotificationType.JOIN_REQUEST_RECEIVED,
      title: 'Permintaan Bergabung Grup',
      message: `${requesterName} meminta izin untuk bergabung ke grup "${group.name}".`,
      metadata: {
        groupId: group.id,
        groupName: group.name,
        requestId: joinRequest.id,
        userId,
        requesterName,
      },
    });

    return {
      message: 'Permintaan bergabung telah dikirimkan, menunggu persetujuan admin/owner grup',
      joinRequest,
    };
  }

  async joinGroup(userId: number, groupId: number) {
    return this.requestJoinGroup(userId, groupId);
  }

  async getJoinRequests(currentUserId: number, groupId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requesterMember = group.members.find((m) => m.user_id === currentUserId);
    const currentUser = await this.prisma.biodata.findUnique({
      where: { user_id: currentUserId },
    });

    const isGroupStaff =
      requesterMember &&
      (requesterMember.role === GroupRole.OWNER || requesterMember.role === GroupRole.ADMIN);
    const isSystemAdmin = currentUser?.role === Role.ADMIN;

    if (!isGroupStaff && !isSystemAdmin) {
      throw new ForbiddenException('Only group owner or admin can view join requests');
    }

    return this.prisma.groupJoinRequest.findMany({
      where: {
        group_id: groupId,
        status: JoinRequestStatus.PENDING,
      },
      include: {
        user: {
          select: { id: true, email: true, biodata: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async approveJoinRequest(currentUserId: number, groupId: number, requestId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requesterMember = group.members.find((m) => m.user_id === currentUserId);
    const currentUser = await this.prisma.biodata.findUnique({
      where: { user_id: currentUserId },
    });

    const isGroupStaff =
      requesterMember &&
      (requesterMember.role === GroupRole.OWNER || requesterMember.role === GroupRole.ADMIN);
    const isSystemAdmin = currentUser?.role === Role.ADMIN;

    if (!isGroupStaff && !isSystemAdmin) {
      throw new ForbiddenException('Only group owner or admin can approve join requests');
    }

    const request = await this.prisma.groupJoinRequest.findFirst({
      where: { id: requestId, group_id: groupId, status: JoinRequestStatus.PENDING },
      include: {
        user: { select: { id: true, email: true, biodata: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Pending join request not found');
    }

    // Update request status
    await this.prisma.groupJoinRequest.update({
      where: { id: requestId },
      data: { status: JoinRequestStatus.APPROVED },
    });

    // Add user as group member if not already
    const member = await this.prisma.groupMember.upsert({
      where: {
        group_id_user_id: { group_id: groupId, user_id: request.user_id },
      },
      update: { role: GroupRole.MEMBER },
      create: {
        group_id: groupId,
        user_id: request.user_id,
        role: GroupRole.MEMBER,
      },
      include: {
        user: { select: { id: true, email: true, biodata: true } },
      },
    });

    const joiningUserName = request.user?.biodata
      ? `${request.user.biodata.first_name} ${request.user.biodata.last_name}`
      : request.user?.email;

    // Send notification to user: request approved
    await this.notificationsService.createAndSend({
      userId: request.user_id,
      type: NotificationType.JOIN_REQUEST_APPROVED,
      title: 'Permintaan Bergabung Disetujui',
      message: `Permintaan Anda untuk bergabung ke grup "${group.name}" telah disetujui.`,
      metadata: { groupId: group.id, groupName: group.name },
    });

    // Notify group members that user joined
    await this.notificationsService.createForGroupMembers(groupId, {
      type: NotificationType.USER_JOINED_GROUP,
      title: 'User Baru Bergabung',
      message: `${joiningUserName} telah bergabung dengan grup "${group.name}".`,
      excludeUserId: request.user_id,
      metadata: { groupId, joinedUserId: request.user_id, userName: joiningUserName },
    });

    return { message: 'Permintaan bergabung disetujui', member };
  }

  async rejectJoinRequest(currentUserId: number, groupId: number, requestId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requesterMember = group.members.find((m) => m.user_id === currentUserId);
    const currentUser = await this.prisma.biodata.findUnique({
      where: { user_id: currentUserId },
    });

    const isGroupStaff =
      requesterMember &&
      (requesterMember.role === GroupRole.OWNER || requesterMember.role === GroupRole.ADMIN);
    const isSystemAdmin = currentUser?.role === Role.ADMIN;

    if (!isGroupStaff && !isSystemAdmin) {
      throw new ForbiddenException('Only group owner or admin can reject join requests');
    }

    const request = await this.prisma.groupJoinRequest.findFirst({
      where: { id: requestId, group_id: groupId, status: JoinRequestStatus.PENDING },
    });

    if (!request) {
      throw new NotFoundException('Pending join request not found');
    }

    await this.prisma.groupJoinRequest.update({
      where: { id: requestId },
      data: { status: JoinRequestStatus.REJECTED },
    });

    // Send notification to user: request rejected
    await this.notificationsService.createAndSend({
      userId: request.user_id,
      type: NotificationType.JOIN_REQUEST_REJECTED,
      title: 'Permintaan Bergabung Ditolak',
      message: `Permintaan Anda untuk bergabung ke grup "${group.name}" telah ditolak.`,
      metadata: { groupId: group.id, groupName: group.name },
    });

    return { message: 'Permintaan bergabung ditolak' };
  }

  async getInviteCode(currentUserId: number, groupId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requester = group.members.find((m) => m.user_id === currentUserId);
    const currentUser = await this.prisma.biodata.findUnique({
      where: { user_id: currentUserId },
    });

    const isStaff = requester && (requester.role === GroupRole.OWNER || requester.role === GroupRole.ADMIN);
    const isSystemAdmin = currentUser?.role === Role.ADMIN;

    if (!isStaff && !isSystemAdmin) {
      throw new ForbiddenException('Hanya admin atau owner grup yang dapat melihat tautan undangan');
    }

    let inviteCode = group.invite_code;
    if (!inviteCode) {
      inviteCode = 'inv_' + crypto.randomBytes(5).toString('hex');
      await this.prisma.group.update({
        where: { id: groupId },
        data: { invite_code: inviteCode },
      });
    }

    return { invite_code: inviteCode };
  }

  async revokeInviteCode(currentUserId: number, groupId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requester = group.members.find((m) => m.user_id === currentUserId);
    const currentUser = await this.prisma.biodata.findUnique({
      where: { user_id: currentUserId },
    });

    const isStaff = requester && (requester.role === GroupRole.OWNER || requester.role === GroupRole.ADMIN);
    const isSystemAdmin = currentUser?.role === Role.ADMIN;

    if (!isStaff && !isSystemAdmin) {
      throw new ForbiddenException('Hanya admin atau owner grup yang dapat menarik tautan undangan');
    }

    const newInviteCode = 'inv_' + crypto.randomBytes(5).toString('hex');
    await this.prisma.group.update({
      where: { id: groupId },
      data: { invite_code: newInviteCode },
    });

    return {
      invite_code: newInviteCode,
      message: 'Tautan undangan grup berhasil diperbarui',
    };
  }

  async previewGroupByInvite(code: string) {
    const group = await this.prisma.group.findFirst({
      where: { invite_code: code, deleted_at: null },
      include: {
        members: { select: { user_id: true } },
        join_requests: {
          where: { status: JoinRequestStatus.PENDING },
          select: { user_id: true },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Tautan undangan tidak valid atau sudah ditarik');
    }

    return {
      id: group.id,
      name: group.name,
      description: group.description,
      invite_code: group.invite_code,
      member_count: group.members.length,
      member_ids: group.members.map((m) => m.user_id),
      pending_request_user_ids: group.join_requests.map((r) => r.user_id),
      created_at: group.created_at,
    };
  }

  async requestJoinByInvite(userId: number, code: string) {
    const group = await this.prisma.group.findFirst({
      where: { invite_code: code, deleted_at: null },
    });

    if (!group) {
      throw new NotFoundException('Tautan undangan tidak valid atau sudah ditarik');
    }

    return this.requestJoinGroup(userId, group.id);
  }

  async removeMember(currentUserId: number, groupId: number, targetUserId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: { include: { user: { include: { biodata: true } } } } },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requesterMember = group.members.find((m) => m.user_id === currentUserId);
    if (!requesterMember) {
      throw new ForbiddenException('You are not a member of this group');
    }

    const isSelfLeaving = currentUserId === targetUserId;

    // Only OWNER or ADMIN of group can remove others, or self can leave
    if (
      !isSelfLeaving &&
      requesterMember.role !== GroupRole.OWNER &&
      requesterMember.role !== GroupRole.ADMIN
    ) {
      throw new ForbiddenException('Only group owner or admin can remove members');
    }

    const targetMember = group.members.find((m) => m.user_id === targetUserId);
    const targetName = targetMember?.user?.biodata
      ? `${targetMember.user.biodata.first_name} ${targetMember.user.biodata.last_name}`
      : targetMember?.user?.email || `User ${targetUserId}`;

    await this.prisma.groupMember.deleteMany({
      where: {
        group_id: groupId,
        user_id: targetUserId,
      },
    });

    if (isSelfLeaving) {
      await this.notificationsService.createForGroupMembers(groupId, {
        type: NotificationType.REMOVED_FROM_GROUP,
        title: 'Anggota Keluar',
        message: `${targetName} telah keluar dari grup "${group.name}".`,
        metadata: { groupId: group.id, groupName: group.name, userId: targetUserId },
      });
      return { message: `Anda telah keluar dari grup "${group.name}"` };
    } else {
      await this.notificationsService.createAndSend({
        userId: targetUserId,
        type: NotificationType.REMOVED_FROM_GROUP,
        title: 'Dikeluarkan dari Grup',
        message: `Anda telah dikeluarkan dari grup "${group.name}".`,
        metadata: { groupId: group.id, groupName: group.name },
      });
      await this.notificationsService.createForGroupMembers(groupId, {
        type: NotificationType.REMOVED_FROM_GROUP,
        title: 'Anggota Dikeluarkan',
        message: `${targetName} telah dikeluarkan dari grup "${group.name}" oleh admin.`,
        excludeUserId: targetUserId,
        metadata: { groupId: group.id, groupName: group.name, userId: targetUserId },
      });
      return { message: `User ${targetUserId} removed from group ${groupId}` };
    }
  }

  async sendGroupMessage(userId: number, groupId: number, dto: SendGroupMessageDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { user_id: userId },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Grup tidak ditemukan');
    }

    const membership = group.members[0];
    if (!membership) {
      throw new ForbiddenException('Anda harus menjadi anggota grup untuk mengirim pesan');
    }

    if (group.only_admins_can_post && membership.role === GroupRole.MEMBER) {
      throw new ForbiddenException('Hanya pengurus/admin yang dapat mengirim pesan di grup pengumuman ini.');
    }

    const message = await this.prisma.groupMessage.create({
      data: {
        group_id: groupId,
        sender_id: userId,
        content: dto.content,
      },
      include: {
        sender: {
          select: { id: true, email: true, biodata: true },
        },
      },
    });

    // Emit real-time message via WebSockets
    this.gateway.sendToGroup(groupId, 'group_message', message);

    return message;
  }

  async getGroupMessages(userId: number, groupId: number) {
    const membership = await this.prisma.groupMember.findFirst({
      where: { group_id: groupId, user_id: userId },
    });

    if (!membership) {
      throw new ForbiddenException('You must be a group member to view messages');
    }

    return this.prisma.groupMessage.findMany({
      where: { group_id: groupId },
      include: {
        sender: {
          select: { id: true, email: true, biodata: true },
        },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  // ====================================================================
  // PERSONAL CHAT (PC / DIRECT MESSAGE)
  // ====================================================================

  async sendDirectMessage(senderId: number, dto: SendDirectMessageDto) {
    const receiver = await this.prisma.user.findFirst({
      where: { id: dto.receiverId, deleted_at: null },
    });

    if (!receiver) {
      throw new NotFoundException('Recipient user not found');
    }

    const message = await this.prisma.directMessage.create({
      data: {
        sender_id: senderId,
        receiver_id: dto.receiverId,
        content: dto.content,
      },
      include: {
        sender: { select: { id: true, email: true, biodata: true } },
        receiver: { select: { id: true, email: true, biodata: true } },
      },
    });

    // Emit real-time message to sender and receiver
    this.gateway.sendToUser(dto.receiverId, 'pc_message', message);
    this.gateway.sendToUser(senderId, 'pc_message', message);

    return message;
  }

  async getDirectMessages(userId: number, otherUserId: number) {
    return this.prisma.directMessage.findMany({
      where: {
        OR: [
          { sender_id: userId, receiver_id: otherUserId },
          { sender_id: otherUserId, receiver_id: userId },
        ],
      },
      include: {
        sender: { select: { id: true, email: true, biodata: true } },
        receiver: { select: { id: true, email: true, biodata: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async getConversations(userId: number) {
    // Retrieve users with whom current user has exchanged DMs
    const sentMessages = await this.prisma.directMessage.findMany({
      where: { sender_id: userId },
      select: { receiver_id: true },
      distinct: ['receiver_id'],
    });

    const receivedMessages = await this.prisma.directMessage.findMany({
      where: { receiver_id: userId },
      select: { sender_id: true },
      distinct: ['sender_id'],
    });

    const contactIds = Array.from(
      new Set([
        ...sentMessages.map((m) => m.receiver_id),
        ...receivedMessages.map((m) => m.sender_id),
      ]),
    );

    return this.prisma.user.findMany({
      where: {
        id: { in: contactIds },
        deleted_at: null,
      },
      select: {
        id: true,
        email: true,
        biodata: true,
      },
    });
  }

  // ====================================================================
  // CHAT EXPORT (FR-EXP-01 s/d FR-EXP-04)
  // ====================================================================

  async exportGroupMessages(
    userId: number,
    groupId: number,
    format: 'txt' | 'json',
    startDate?: string,
    endDate?: string,
  ) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          where: { user_id: userId },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Grup tidak ditemukan');
    }

    if (!group.members.length) {
      throw new ForbiddenException('Ekspor riwayat grup dibatasi hanya untuk anggota aktif yang terdaftar.');
    }

    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const where: any = { group_id: groupId };
    if (startDate || endDate) {
      where.created_at = dateFilter;
    }

    const messages = await this.prisma.groupMessage.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            biodata: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    if (format === 'json') {
      return {
        contentType: 'application/json; charset=utf-8',
        filename: `group_${group.id}_${group.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.json`,
        data: JSON.stringify(
          {
            type: 'group',
            groupId: group.id,
            groupName: group.name,
            exportedAt: new Date().toISOString(),
            dateRange: { startDate: startDate || null, endDate: endDate || null },
            totalMessages: messages.length,
            messages: messages.map((m) => ({
              id: m.id,
              timestamp: m.created_at,
              senderId: m.sender_id,
              senderName: m.sender.biodata
                ? `${m.sender.biodata.first_name} ${m.sender.biodata.last_name}`
                : m.sender.email,
              senderEmail: m.sender.email,
              content: m.content,
            })),
          },
          null,
          2,
        ),
      };
    } else {
      let txtContent = `====================================================\n`;
      txtContent += `EKSPOR RIWAYAT CHAT GRUP: ${group.name}\n`;
      txtContent += `Tanggal Ekspor : ${new Date().toLocaleString('id-ID')}\n`;
      txtContent += `Filter Rentang : ${startDate ? startDate : 'Semua'} s/d ${endDate ? endDate : 'Semua'}\n`;
      txtContent += `Total Pesan    : ${messages.length}\n`;
      txtContent += `====================================================\n\n`;

      for (const m of messages) {
        const senderName = m.sender.biodata
          ? `${m.sender.biodata.first_name} ${m.sender.biodata.last_name}`
          : m.sender.email;
        const timeStr = new Date(m.created_at).toISOString().replace('T', ' ').substring(0, 19);
        txtContent += `[${timeStr}] ${senderName}: ${m.content}\n`;
      }

      return {
        contentType: 'text/plain; charset=utf-8',
        filename: `group_${group.id}_${group.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.txt`,
        data: txtContent,
      };
    }
  }

  async exportDirectMessages(
    userId: number,
    otherUserId: number,
    format: 'txt' | 'json',
    startDate?: string,
    endDate?: string,
  ) {
    const otherUser = await this.prisma.user.findUnique({
      where: { id: otherUserId },
      include: { biodata: true },
    });

    if (!otherUser) {
      throw new NotFoundException('Pengguna tidak ditemukan');
    }

    const otherName = otherUser.biodata
      ? `${otherUser.biodata.first_name} ${otherUser.biodata.last_name}`
      : otherUser.email;

    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const where: any = {
      OR: [
        { sender_id: userId, receiver_id: otherUserId },
        { sender_id: otherUserId, receiver_id: userId },
      ],
    };

    if (startDate || endDate) {
      where.created_at = dateFilter;
    }

    const messages = await this.prisma.directMessage.findMany({
      where,
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            biodata: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    if (format === 'json') {
      return {
        contentType: 'application/json; charset=utf-8',
        filename: `pc_${otherUserId}_${otherName.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.json`,
        data: JSON.stringify(
          {
            type: 'direct',
            participantId: otherUserId,
            participantName: otherName,
            exportedAt: new Date().toISOString(),
            dateRange: { startDate: startDate || null, endDate: endDate || null },
            totalMessages: messages.length,
            messages: messages.map((m) => ({
              id: m.id,
              timestamp: m.created_at,
              senderId: m.sender_id,
              senderName: m.sender.biodata
                ? `${m.sender.biodata.first_name} ${m.sender.biodata.last_name}`
                : m.sender.email,
              senderEmail: m.sender.email,
              content: m.content,
            })),
          },
          null,
          2,
        ),
      };
    } else {
      let txtContent = `====================================================\n`;
      txtContent += `EKSPOR RIWAYAT CHAT PRIBADI: ${otherName}\n`;
      txtContent += `Tanggal Ekspor : ${new Date().toLocaleString('id-ID')}\n`;
      txtContent += `Filter Rentang : ${startDate ? startDate : 'Semua'} s/d ${endDate ? endDate : 'Semua'}\n`;
      txtContent += `Total Pesan    : ${messages.length}\n`;
      txtContent += `====================================================\n\n`;

      for (const m of messages) {
        const senderName = m.sender.biodata
          ? `${m.sender.biodata.first_name} ${m.sender.biodata.last_name}`
          : m.sender.email;
        const timeStr = new Date(m.created_at).toISOString().replace('T', ' ').substring(0, 19);
        txtContent += `[${timeStr}] ${senderName}: ${m.content}\n`;
      }

      return {
        contentType: 'text/plain; charset=utf-8',
        filename: `pc_${otherUserId}_${otherName.replace(/[^a-zA-Z0-9_-]/g, '_')}_export.txt`,
        data: txtContent,
      };
    }
  }
}
