import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CallsService } from './calls.service';
import { PrismaService } from '@common/prisma/prisma.service';
import { CallMediaType, CallStatus, CallType } from '@prisma/client';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'ws',
})
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CallsGateway.name);

  // In-memory track group call participants: groupId -> Set of { socketId, userId, userName }
  private groupCallParticipants = new Map<
    number,
    Map<string, { userId: number; userName: string; mediaType?: string }>
  >();

  // Track pending 1-on-1 call timeouts: callId -> NodeJS.Timeout (BR-CALL-01, BR-VC-02: 30s ring limit)
  private callTimeouts = new Map<number, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly callsService: CallsService,
    private readonly prisma: PrismaService,
  ) {}

  private clearCallTimeout(callId: number) {
    const timer = this.callTimeouts.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.callTimeouts.delete(callId);
    }
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (token) {
        const payload = this.jwtService.verify(token);
        client.data.user = payload;
        await client.join(`user_${payload.userId}`);
        this.logger.log(`Calls client ${client.id} joined user_${payload.userId}`);
      }
    } catch (err) {
      // Handled in NotificationsGateway
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.user?.userId;
    // Check if client was in any group calls and clean up
    this.groupCallParticipants.forEach((participants, groupId) => {
      if (participants.has(client.id)) {
        const info = participants.get(client.id);
        participants.delete(client.id);
        this.server.to(`group_${groupId}`).emit('group_call:user_left', {
          userId: info?.userId,
          socketId: client.id,
          participantsCount: participants.size,
        });
      }
    });
  }

  // ==========================================
  // 1-ON-1 VOICE CALL SIGNALING (FR-CALL-01, FR-CALL-03, FR-CALL-05)
  // ==========================================

  // ==========================================
  // 1-ON-1 AUDIO / VIDEO CALL SIGNALING (FR-CALL-01..05, FR-VC-01..04)
  // ==========================================

  @SubscribeMessage('call:initiate')
  async handleCallInitiate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { receiverId: number; callerName: string; mediaType?: 'AUDIO' | 'VIDEO' },
  ) {
    const callerId = client.data?.user?.userId;
    if (!callerId || !data.receiverId) return;

    // Verify caller and receiver for region isolation (FR-USER-02, BR-TENANT-02)
    const caller = await this.prisma.user.findUnique({
      where: { id: callerId },
      select: { id: true, role: true, region_id: true },
    });
    const receiver = await this.prisma.user.findUnique({
      where: { id: data.receiverId },
      select: { id: true, role: true, region_id: true },
    });

    if (!caller || !receiver) {
      client.emit('call:error', { message: 'Pengguna tidak ditemukan.' });
      return { error: 'USER_NOT_FOUND' };
    }

    if (
      caller.role !== 'SUPER_ADMIN' &&
      receiver.role !== 'SUPER_ADMIN' &&
      caller.region_id &&
      receiver.region_id &&
      caller.region_id !== receiver.region_id
    ) {
      client.emit('call:error', {
        message: 'Akses ditolak: Panggilan antar wilayah/region tidak diizinkan.',
      });
      return { error: 'REGION_MISMATCH' };
    }

    const mediaType =
      data.mediaType === 'VIDEO' ? CallMediaType.VIDEO : CallMediaType.AUDIO;

    const callSession = await this.callsService.initiateCall({
      callerId,
      receiverId: data.receiverId,
      callType: CallType.DIRECT,
      mediaType,
      regionId: caller.region_id || null,
    });

    // Notify receiver with incoming call event & ringing
    this.server.to(`user_${data.receiverId}`).emit('call:incoming', {
      callId: callSession.id,
      callerId,
      callerName: data.callerName || 'Pengguna',
      callType: 'DIRECT',
      mediaType: data.mediaType || 'AUDIO',
    });

    // BR-CALL-01, BR-VC-02: 30 seconds ring timeout -> auto mark as MISSED if unanswered
    const timeout = setTimeout(async () => {
      this.callTimeouts.delete(callSession.id);
      await this.callsService.updateCallStatus(callSession.id, CallStatus.MISSED, 0);

      this.server.to(`user_${callerId}`).emit('call:timeout', {
        callId: callSession.id,
        message: 'Panggilan tidak dijawab (waktu habis 30 detik).',
      });
      this.server.to(`user_${data.receiverId}`).emit('call:timeout', {
        callId: callSession.id,
        message: 'Panggilan tak terjawab.',
      });
    }, 30000);

    this.callTimeouts.set(callSession.id, timeout);

    return { callId: callSession.id, mediaType };
  }

  @SubscribeMessage('call:accept')
  async handleCallAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: number; callerId: number },
  ) {
    this.clearCallTimeout(data.callId);

    const receiverId = client.data?.user?.userId;
    this.server.to(`user_${data.callerId}`).emit('call:accepted', {
      callId: data.callId,
      receiverId,
    });
    return { status: 'accepted' };
  }

  @SubscribeMessage('call:reject')
  async handleCallReject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: number; callerId: number; reason?: string },
  ) {
    this.clearCallTimeout(data.callId);

    await this.callsService.updateCallStatus(data.callId, CallStatus.REJECTED);

    this.server.to(`user_${data.callerId}`).emit('call:rejected', {
      callId: data.callId,
      reason: data.reason || 'Panggilan ditolak.',
    });
    return { status: 'rejected' };
  }

  @SubscribeMessage('call:signal')
  async handleCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: number; signal: any },
  ) {
    const senderId = client.data?.user?.userId;
    this.server.to(`user_${data.targetUserId}`).emit('call:signal', {
      senderId,
      signal: data.signal,
    });
  }

  // Screen sharing & media toggles (FR-VC-03)
  @SubscribeMessage('call:screen_share_start')
  async handleScreenShareStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId?: number; groupId?: number },
  ) {
    const senderId = client.data?.user?.userId;
    if (data.targetUserId) {
      this.server.to(`user_${data.targetUserId}`).emit('call:screen_share_started', {
        userId: senderId,
      });
    }
    if (data.groupId) {
      this.server.to(`group_call_${data.groupId}`).emit('group_call:screen_share_started', {
        userId: senderId,
        socketId: client.id,
      });
    }
  }

  @SubscribeMessage('call:screen_share_stop')
  async handleScreenShareStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId?: number; groupId?: number },
  ) {
    const senderId = client.data?.user?.userId;
    if (data.targetUserId) {
      this.server.to(`user_${data.targetUserId}`).emit('call:screen_share_stopped', {
        userId: senderId,
      });
    }
    if (data.groupId) {
      this.server.to(`group_call_${data.groupId}`).emit('group_call:screen_share_stopped', {
        userId: senderId,
        socketId: client.id,
      });
    }
  }

  @SubscribeMessage('call:end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { callId: number; targetUserId?: number; groupId?: number; duration: number },
  ) {
    this.clearCallTimeout(data.callId);

    await this.callsService.updateCallStatus(
      data.callId,
      CallStatus.COMPLETED,
      data.duration || 0,
    );

    if (data.targetUserId) {
      this.server.to(`user_${data.targetUserId}`).emit('call:ended', {
        callId: data.callId,
        duration: data.duration,
      });
    }

    if (data.groupId) {
      this.server.to(`group_${data.groupId}`).emit('call:ended', {
        callId: data.callId,
        duration: data.duration,
      });
    }

    return { status: 'ended' };
  }

  // ==========================================
  // GROUP CALL (AUDIO / VIDEO - MAX 8 PARTICIPANTS BR-VC-01)
  // ==========================================

  @SubscribeMessage('group_call:join')
  async handleGroupCallJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: number; userName: string; mediaType?: 'AUDIO' | 'VIDEO' },
  ) {
    const userId = client.data?.user?.userId;
    if (!userId || !data.groupId) return;

    // Verify group region isolation
    const group = await this.prisma.group.findUnique({
      where: { id: data.groupId },
      select: { id: true, region_id: true },
    });
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, region_id: true },
    });

    if (
      group?.region_id &&
      user &&
      user.role !== 'SUPER_ADMIN' &&
      user.region_id &&
      user.region_id !== group.region_id
    ) {
      client.emit('group_call:error', {
        message: 'Akses ditolak: Grup berada di wilayah/region berbeda.',
      });
      return { error: 'REGION_MISMATCH' };
    }

    if (!this.groupCallParticipants.has(data.groupId)) {
      this.groupCallParticipants.set(data.groupId, new Map());
    }

    const participants = this.groupCallParticipants.get(data.groupId)!;

    // Check maximum 8 participants restriction (BR-VC-01, FR-CALL-02)
    if (participants.size >= 8 && !participants.has(client.id)) {
      client.emit('group_call:error', {
        message: 'Kapasitas panggilan grup penuh (maksimal 8 peserta aktif).',
      });
      return { error: 'GROUP_CALL_FULL' };
    }

    // Register participant
    participants.set(client.id, {
      userId,
      userName: data.userName,
      mediaType: data.mediaType || 'AUDIO',
    });

    // Join socket room
    await client.join(`group_call_${data.groupId}`);

    // Return existing participants to new joiner
    const existingList = Array.from(participants.entries())
      .filter(([sockId]) => sockId !== client.id)
      .map(([sockId, info]) => ({
        socketId: sockId,
        userId: info.userId,
        userName: info.userName,
        mediaType: info.mediaType,
      }));

    // Broadcast to other participants that someone joined
    client.to(`group_call_${data.groupId}`).emit('group_call:user_joined', {
      socketId: client.id,
      userId,
      userName: data.userName,
      mediaType: data.mediaType || 'AUDIO',
      participantsCount: participants.size,
    });

    return {
      participants: existingList,
      participantsCount: participants.size,
    };
  }

  @SubscribeMessage('group_call:signal')
  async handleGroupCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetSocketId: string; signal: any },
  ) {
    const senderId = client.data?.user?.userId;
    this.server.to(data.targetSocketId).emit('group_call:signal', {
      senderSocketId: client.id,
      senderUserId: senderId,
      signal: data.signal,
    });
  }

  @SubscribeMessage('group_call:leave')
  async handleGroupCallLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: number },
  ) {
    const userId = client.data?.user?.userId;
    if (!data.groupId) return;

    const participants = this.groupCallParticipants.get(data.groupId);
    if (participants) {
      participants.delete(client.id);
      await client.leave(`group_call_${data.groupId}`);

      this.server.to(`group_call_${data.groupId}`).emit('group_call:user_left', {
        socketId: client.id,
        userId,
        participantsCount: participants.size,
      });
    }

    return { status: 'left' };
  }
}
