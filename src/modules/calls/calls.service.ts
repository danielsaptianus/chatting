import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@common/prisma/prisma.service';
import { CallStatus, CallType } from '@prisma/client';

@Injectable()
export class CallsService {
  constructor(private readonly prisma: PrismaService) {}

  // Format seconds to MM:SS
  private formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  async initiateCall(data: {
    callerId: number;
    receiverId?: number;
    groupId?: number;
    callType: CallType;
  }) {
    const callSession = await this.prisma.callSession.create({
      data: {
        caller_id: data.callerId,
        receiver_id: data.receiverId || null,
        group_id: data.groupId || null,
        call_type: data.callType,
        status: CallStatus.MISSED, // Default until accepted
      },
      include: {
        caller: {
          select: { id: true, email: true, biodata: true },
        },
        receiver: {
          select: { id: true, email: true, biodata: true },
        },
        group: {
          select: { id: true, name: true },
        },
      },
    });

    return callSession;
  }

  async updateCallStatus(callId: number, status: CallStatus, duration: number = 0) {
    const session = await this.prisma.callSession.findUnique({
      where: { id: callId },
      include: {
        caller: { select: { id: true, email: true, biodata: true } },
        receiver: { select: { id: true, email: true, biodata: true } },
        group: { select: { id: true, name: true } },
      },
    });

    if (!session) {
      return null;
    }

    const updated = await this.prisma.callSession.update({
      where: { id: callId },
      data: {
        status,
        ended_at: new Date(),
        duration,
      },
    });

    // Record system log message into chat history (FR-CALL-05)
    try {
      let content = '';
      const durStr = this.formatDuration(duration);

      if (status === CallStatus.COMPLETED) {
        content = `📞 Panggilan Suara Selesai (${durStr})`;
      } else if (status === CallStatus.REJECTED) {
        content = `📞 Panggilan Ditolak`;
      } else if (status === CallStatus.MISSED) {
        content = `📞 Panggilan Tak Terjawab`;
      } else if (status === CallStatus.BUSY) {
        content = `📞 Panggilan Sibuk`;
      }

      if (session.call_type === CallType.DIRECT && session.receiver_id) {
        await this.prisma.directMessage.create({
          data: {
            sender_id: session.caller_id,
            receiver_id: session.receiver_id,
            content,
          },
        });
      } else if (session.call_type === CallType.GROUP && session.group_id) {
        await this.prisma.groupMessage.create({
          data: {
            group_id: session.group_id,
            sender_id: session.caller_id,
            content: `📞 Panggilan Suara Grup (${status === CallStatus.COMPLETED ? `Selesai, ${durStr}` : status})`,
          },
        });
      }
    } catch (e) {
      // Ignore message insert errors
    }

    return updated;
  }

  async getCallHistory(userId: number) {
    return this.prisma.callSession.findMany({
      where: {
        OR: [{ caller_id: userId }, { receiver_id: userId }],
      },
      include: {
        caller: { select: { id: true, email: true, biodata: true } },
        receiver: { select: { id: true, email: true, biodata: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { started_at: 'desc' },
      take: 50,
    });
  }
}
