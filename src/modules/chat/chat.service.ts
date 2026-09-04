import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { CreateGroupDto } from './dto/create-group.dto';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { SendDirectMessageDto } from './dto/send-direct-message.dto';
import { GroupRole, NotificationType } from '@prisma/client';

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
    const group = await this.prisma.group.create({
      data: {
        name: dto.name,
        description: dto.description,
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

  async getAllGroups() {
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

    // Check if requester is member of group
    const isMember = group.members.some((m) => m.user_id === currentUserId);
    if (!isMember) {
      throw new ForbiddenException('You must be a member of this group to add someone');
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

  async joinGroup(userId: number, groupId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: {
        members: {
          include: { user: { select: { id: true, email: true, biodata: true } } },
        },
      },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const isMember = group.members.some((m) => m.user_id === userId);
    if (isMember) {
      throw new BadRequestException('You are already a member of this group');
    }

    const member = await this.prisma.groupMember.create({
      data: {
        group_id: groupId,
        user_id: userId,
        role: GroupRole.MEMBER,
      },
      include: {
        user: { select: { id: true, email: true, biodata: true } },
      },
    });

    const joiningUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { biodata: true },
    });

    const userName = joiningUser?.biodata
      ? `${joiningUser.biodata.first_name} ${joiningUser.biodata.last_name}`
      : joiningUser?.email;

    // Fire notification to existing group members: "notif user masuk ke grup"
    await this.notificationsService.createForGroupMembers(groupId, {
      type: NotificationType.USER_JOINED_GROUP,
      title: 'User Baru Bergabung',
      message: `${userName} telah bergabung dengan grup "${group.name}".`,
      excludeUserId: userId,
      metadata: { groupId, joinedUserId: userId, userName },
    });

    return member;
  }

  async removeMember(currentUserId: number, groupId: number, targetUserId: number) {
    const group = await this.prisma.group.findFirst({
      where: { id: groupId, deleted_at: null },
      include: { members: true },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requesterMember = group.members.find((m) => m.user_id === currentUserId);
    if (!requesterMember) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // Only OWNER or ADMIN of group can remove others, or self can leave
    if (
      currentUserId !== targetUserId &&
      requesterMember.role !== GroupRole.OWNER &&
      requesterMember.role !== GroupRole.ADMIN
    ) {
      throw new ForbiddenException('Only group owner or admin can remove members');
    }

    await this.prisma.groupMember.deleteMany({
      where: {
        group_id: groupId,
        user_id: targetUserId,
      },
    });

    // Fire notification: "notif dikeluarkan dari grup"
    await this.notificationsService.createAndSend({
      userId: targetUserId,
      type: NotificationType.REMOVED_FROM_GROUP,
      title: 'Dikeluarkan dari Grup',
      message: `Anda telah dikeluarkan dari grup "${group.name}".`,
      metadata: { groupId: group.id, groupName: group.name },
    });

    return { message: `User ${targetUserId} removed from group ${groupId}` };
  }

  async sendGroupMessage(userId: number, groupId: number, dto: SendGroupMessageDto) {
    // Check membership
    const membership = await this.prisma.groupMember.findFirst({
      where: { group_id: groupId, user_id: userId },
    });

    if (!membership) {
      throw new ForbiddenException('You must be a group member to send messages');
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
}
