import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async createAndSend(data: {
    userId: number;
    type: NotificationType;
    title: string;
    message: string;
    metadata?: any;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        user_id: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        metadata: data.metadata || {},
      },
    });

    // Real-time WebSocket emission to target user
    this.gateway.sendToUser(data.userId, 'notification', notification);
    return notification;
  }

  async createForGroupMembers(
    groupId: number,
    data: {
      type: NotificationType;
      title: string;
      message: string;
      excludeUserId?: number;
      metadata?: any;
    },
  ) {
    const members = await this.prisma.groupMember.findMany({
      where: { group_id: groupId },
    });

    const targetMembers = members.filter(
      (m) => !data.excludeUserId || m.user_id !== data.excludeUserId,
    );

    const notifications = await Promise.all(
      targetMembers.map((member) =>
        this.createAndSend({
          userId: member.user_id,
          type: data.type,
          title: data.title,
          message: data.message,
          metadata: data.metadata,
        }),
      ),
    );

    return notifications;
  }

  async getUserNotifications(userId: number) {
    return this.prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
  }

  async markAsRead(id: number, userId: number) {
    return this.prisma.notification.updateMany({
      where: { id, user_id: userId },
      data: { is_read: true },
    });
  }
}
