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

interface GroupCallSessionState {
  groupId: number;
  groupName: string;
  initiatorName: string;
  mediaType: 'AUDIO' | 'VIDEO';
  startedAt: Date;
  callSessionId?: number;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'ws',
})
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CallsGateway.name);

  // In-memory track group call participants: groupId -> Map of { socketId => { userId, userName, mediaType } }
  private groupCallParticipants = new Map<
    number,
    Map<string, { userId: number; userName: string; mediaType?: string }>
  >();

  // In-memory track active group calls metadata: groupId -> GroupCallSessionState
  private activeGroupCalls = new Map<number, GroupCallSessionState>();

  // Track pending 1-on-1 call timeouts: callId -> NodeJS.Timeout (BR-CALL-01, BR-VC-02: 30s ring limit)
  private callTimeouts = new Map<number, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly callsService: CallsService,
    private readonly prisma: PrismaService,
  ) {}

  private clearCallTimeout(callId: number) {
    if (!callId) return;
    const timer = this.callTimeouts.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.callTimeouts.delete(callId);
    }
  }

  private getClientUser(client: Socket): { userId: number; email: string; role: string; region_id?: number } | null {
    if (client.data?.user?.userId) {
      return client.data.user;
    }

    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '') ||
        (client.handshake.query?.token as string);

      if (token) {
        const payload = this.jwtService.verify(token);
        client.data.user = payload;
        client.join(`user_${payload.userId}`);
        return payload;
      }
    } catch (err: any) {
      this.logger.debug(`CallsGateway: token verify failed for ${client.id}: ${err.message}`);
    }

    return null;
  }

  async handleConnection(client: Socket) {
    try {
      const user = this.getClientUser(client);
      if (user) {
        await client.join(`user_${user.userId}`);
        this.logger.log(`Calls client ${client.id} joined room user_${user.userId}`);
      }
    } catch (err: any) {
      this.logger.debug(`Calls client connection issue: ${err.message}`);
    }
  }

  private async cleanupGroupCallParticipant(groupId: number, socketId: string, userId: number | null) {
    const participants = this.groupCallParticipants.get(groupId);
    if (!participants || !participants.has(socketId)) return;

    participants.delete(socketId);
    this.logger.log(`Client ${socketId} (User ${userId}) left group_call_${groupId}. Sisa peserta: ${participants.size}`);

    this.server.to(`group_call_${groupId}`).emit('group_call:user_left', {
      socketId,
      userId,
      participantsCount: participants.size,
    });
    this.server.to(`group_${groupId}`).emit('group_call:user_left', {
      socketId,
      userId,
      participantsCount: participants.size,
    });

    if (participants.size === 0) {
      this.groupCallParticipants.delete(groupId);
      const active = this.activeGroupCalls.get(groupId);
      if (active) {
        const duration = Math.max(1, Math.floor((Date.now() - active.startedAt.getTime()) / 1000));
        if (active.callSessionId) {
          try {
            await this.callsService.updateCallStatus(active.callSessionId, CallStatus.COMPLETED, duration);
          } catch (e: any) {
            this.logger.error(`Gagal memperbarui status sesi panggilan grup: ${e.message}`);
          }
        }
        this.activeGroupCalls.delete(groupId);
      }
      this.server.to(`group_${groupId}`).emit('group_call:ended', { groupId });
    } else {
      const active = this.activeGroupCalls.get(groupId);
      this.server.to(`group_${groupId}`).emit('group_call:status_updated', {
        groupId,
        isActive: true,
        participantsCount: participants.size,
        mediaType: active?.mediaType || 'AUDIO',
        initiatorName: active?.initiatorName || 'Peserta',
      });
    }
  }

  async handleDisconnect(client: Socket) {
    const user = this.getClientUser(client);
    const userId = user?.userId ? Number(user.userId) : null;

    // Check if client was in any group calls and clean up
    for (const [groupId, participants] of this.groupCallParticipants.entries()) {
      if (participants.has(client.id)) {
        await this.cleanupGroupCallParticipant(groupId, client.id, userId);
      }
    }
  }

  // ==========================================
  // 1-ON-1 AUDIO / VIDEO CALL SIGNALING (FR-CALL-01..05, FR-VC-01..04)
  // ==========================================

  @SubscribeMessage('call:initiate')
  async handleCallInitiate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { receiverId: number | string; callerName?: string; mediaType?: 'AUDIO' | 'VIDEO' },
  ) {
    try {
      const user = this.getClientUser(client);
      const callerId = user?.userId ? Number(user.userId) : null;
      const receiverId = data?.receiverId ? Number(data.receiverId) : null;

      if (!callerId) {
        this.logger.warn(`Call initiate rejected: Unauthorized client ${client.id}`);
        client.emit('call:error', { message: 'Sesi Anda telah berakhir. Silakan login kembali.' });
        return { error: 'UNAUTHORIZED' };
      }

      if (!receiverId || isNaN(receiverId)) {
        this.logger.warn(`Call initiate rejected: Invalid receiverId '${data?.receiverId}'`);
        client.emit('call:error', { message: 'ID pengguna tujuan tidak valid.' });
        return { error: 'INVALID_RECEIVER' };
      }

      if (callerId === receiverId) {
        client.emit('call:error', { message: 'Tidak dapat melakukan panggilan ke diri sendiri.' });
        return { error: 'SELF_CALL' };
      }

      // Verify caller and receiver for region isolation (FR-USER-02, BR-TENANT-02)
      const caller = await this.prisma.user.findUnique({
        where: { id: callerId },
        select: { id: true, region_id: true, biodata: { select: { role: true } } },
      });
      const receiver = await this.prisma.user.findUnique({
        where: { id: receiverId },
        select: { id: true, region_id: true, biodata: { select: { role: true } } },
      });

      if (!caller || !receiver) {
        client.emit('call:error', { message: 'Pengguna tujuan tidak ditemukan.' });
        return { error: 'USER_NOT_FOUND' };
      }

      const callerRole = caller.biodata?.role || 'USER';
      const receiverRole = receiver.biodata?.role || 'USER';

      if (
        callerRole !== 'SUPER_ADMIN' &&
        receiverRole !== 'SUPER_ADMIN' &&
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
        receiverId,
        callType: CallType.DIRECT,
        mediaType,
        regionId: caller.region_id || null,
      });

      this.logger.log(
        `Call #${callSession.id} (${mediaType}) initiated: User ${callerId} -> User ${receiverId}`,
      );

      // Notify receiver with incoming call event & ringing
      this.server.to(`user_${receiverId}`).emit('call:incoming', {
        callId: callSession.id,
        callerId,
        callerName: data.callerName || 'Pengguna',
        callType: 'DIRECT',
        mediaType: data.mediaType || 'AUDIO',
      });

      // BR-CALL-01, BR-VC-02: 30 seconds ring timeout -> auto mark as MISSED if unanswered
      const timeout = setTimeout(async () => {
        this.callTimeouts.delete(callSession.id);
        this.logger.log(`Call #${callSession.id} timed out after 30s`);
        await this.callsService.updateCallStatus(callSession.id, CallStatus.MISSED, 0);

        this.server.to(`user_${callerId}`).emit('call:timeout', {
          callId: callSession.id,
          message: 'Panggilan tidak dijawab (waktu habis 30 detik).',
        });
        this.server.to(`user_${receiverId}`).emit('call:timeout', {
          callId: callSession.id,
          message: 'Panggilan tak terjawab.',
        });
      }, 30000);

      this.callTimeouts.set(callSession.id, timeout);

      return { callId: callSession.id, mediaType: data.mediaType || 'AUDIO' };
    } catch (err: any) {
      this.logger.error(`Error in handleCallInitiate: ${err.message}`, err.stack);
      client.emit('call:error', { message: 'Terjadi kesalahan sistem saat memulai panggilan.' });
      return { error: 'SERVER_ERROR' };
    }
  }

  @SubscribeMessage('call:accept')
  async handleCallAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: number | string; callerId: number | string },
  ) {
    try {
      const callId = Number(data.callId);
      const callerId = Number(data.callerId);
      this.clearCallTimeout(callId);

      const user = this.getClientUser(client);
      const receiverId = user?.userId ? Number(user.userId) : null;

      this.logger.log(`Call #${callId} accepted by User ${receiverId} for Caller ${callerId}`);

      this.server.to(`user_${callerId}`).emit('call:accepted', {
        callId,
        receiverId,
      });
      return { status: 'accepted' };
    } catch (err: any) {
      this.logger.error(`Error in handleCallAccept: ${err.message}`);
      return { error: 'SERVER_ERROR' };
    }
  }

  @SubscribeMessage('call:reject')
  async handleCallReject(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { callId: number | string; callerId: number | string; reason?: string },
  ) {
    try {
      const callId = Number(data.callId);
      const callerId = Number(data.callerId);
      this.clearCallTimeout(callId);

      this.logger.log(`Call #${callId} rejected for Caller ${callerId}`);

      await this.callsService.updateCallStatus(callId, CallStatus.REJECTED);

      this.server.to(`user_${callerId}`).emit('call:rejected', {
        callId,
        reason: data.reason || 'Panggilan ditolak.',
      });
      return { status: 'rejected' };
    } catch (err: any) {
      this.logger.error(`Error in handleCallReject: ${err.message}`);
      return { error: 'SERVER_ERROR' };
    }
  }

  @SubscribeMessage('call:signal')
  async handleCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId: number | string; signal: any },
  ) {
    try {
      const user = this.getClientUser(client);
      const senderId = user?.userId ? Number(user.userId) : null;
      const targetUserId = Number(data.targetUserId);

      if (!targetUserId || isNaN(targetUserId)) return;

      this.server.to(`user_${targetUserId}`).emit('call:signal', {
        senderId,
        signal: data.signal,
      });
    } catch (err: any) {
      this.logger.debug(`Error in handleCallSignal: ${err.message}`);
    }
  }

  // Screen sharing & media toggles (FR-VC-03)
  @SubscribeMessage('call:screen_share_start')
  async handleScreenShareStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId?: number | string; groupId?: number | string },
  ) {
    const user = this.getClientUser(client);
    const senderId = user?.userId ? Number(user.userId) : null;

    if (data.targetUserId) {
      const targetUserId = Number(data.targetUserId);
      this.server.to(`user_${targetUserId}`).emit('call:screen_share_started', {
        userId: senderId,
      });
    }
    if (data.groupId) {
      const groupId = Number(data.groupId);
      this.server.to(`group_call_${groupId}`).emit('group_call:screen_share_started', {
        userId: senderId,
        socketId: client.id,
      });
    }
  }

  @SubscribeMessage('call:screen_share_stop')
  async handleScreenShareStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetUserId?: number | string; groupId?: number | string },
  ) {
    const user = this.getClientUser(client);
    const senderId = user?.userId ? Number(user.userId) : null;

    if (data.targetUserId) {
      const targetUserId = Number(data.targetUserId);
      this.server.to(`user_${targetUserId}`).emit('call:screen_share_stopped', {
        userId: senderId,
      });
    }
    if (data.groupId) {
      const groupId = Number(data.groupId);
      this.server.to(`group_call_${groupId}`).emit('group_call:screen_share_stopped', {
        userId: senderId,
        socketId: client.id,
      });
    }
  }

  @SubscribeMessage('call:end')
  async handleCallEnd(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { callId?: number | string; targetUserId?: number | string; groupId?: number | string; duration?: number },
  ) {
    try {
      const callId = data.callId ? Number(data.callId) : null;
      const targetUserId = data.targetUserId ? Number(data.targetUserId) : null;
      const groupId = data.groupId ? Number(data.groupId) : null;
      const duration = Number(data.duration) || 0;

      if (callId) {
        this.clearCallTimeout(callId);
        this.logger.log(`Call #${callId} ended after ${duration} seconds`);
        await this.callsService.updateCallStatus(callId, CallStatus.COMPLETED, duration);
      }

      if (targetUserId) {
        this.server.to(`user_${targetUserId}`).emit('call:ended', {
          callId,
          duration,
        });
      }

      if (groupId) {
        this.server.to(`group_call_${groupId}`).emit('call:ended', {
          callId,
          duration,
        });
        this.server.to(`group_${groupId}`).emit('call:ended', {
          callId,
          duration,
        });
      }

      return { status: 'ended' };
    } catch (err: any) {
      this.logger.error(`Error in handleCallEnd: ${err.message}`);
      return { error: 'SERVER_ERROR' };
    }
  }

  // ==========================================
  // GROUP CALL (AUDIO / VIDEO - MAX 8 PARTICIPANTS BR-VC-01)
  // ==========================================

  @SubscribeMessage('group_call:join')
  async handleGroupCallJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: number | string; userName: string; mediaType?: 'AUDIO' | 'VIDEO' },
  ) {
    try {
      const user = this.getClientUser(client);
      const userId = user?.userId ? Number(user.userId) : null;
      const groupId = data.groupId ? Number(data.groupId) : null;

      if (!userId || !groupId) {
        client.emit('group_call:error', { message: 'Permintaan bergabung tidak valid.' });
        return { error: 'INVALID_REQUEST' };
      }

      // Verify group region isolation
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        select: { id: true, name: true, region_id: true },
      });
      const dbUser = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, region_id: true, biodata: { select: { role: true } } },
      });

      const userRole = dbUser?.biodata?.role || 'USER';

      if (
        group?.region_id &&
        dbUser &&
        userRole !== 'SUPER_ADMIN' &&
        dbUser.region_id &&
        dbUser.region_id !== group.region_id
      ) {
        client.emit('group_call:error', {
          message: 'Akses ditolak: Grup berada di wilayah/region berbeda.',
        });
        return { error: 'REGION_MISMATCH' };
      }

      if (!this.groupCallParticipants.has(groupId)) {
        this.groupCallParticipants.set(groupId, new Map());
      }

      const participants = this.groupCallParticipants.get(groupId)!;

      // Check maximum 8 participants restriction (BR-VC-01, FR-CALL-02)
      if (participants.size >= 8 && !participants.has(client.id)) {
        client.emit('group_call:error', {
          message: 'Kapasitas panggilan grup penuh (maksimal 8 peserta aktif).',
        });
        return { error: 'GROUP_CALL_FULL' };
      }

      const isFirstParticipant = participants.size === 0;

      // Register participant
      participants.set(client.id, {
        userId,
        userName: data.userName || 'Peserta',
        mediaType: data.mediaType || 'AUDIO',
      });

      // Join socket room
      await client.join(`group_call_${groupId}`);

      // If first participant, create CallSession, track active call, and notify group members!
      if (isFirstParticipant) {
        let callSessionId: number | undefined;
        try {
          const session = await this.callsService.initiateCall({
            callerId: userId,
            groupId,
            callType: CallType.GROUP,
            mediaType: data.mediaType === 'VIDEO' ? CallMediaType.VIDEO : CallMediaType.AUDIO,
            regionId: group?.region_id || null,
          });
          callSessionId = session.id;
        } catch (e: any) {
          this.logger.error(`Failed to initiate group call session: ${e.message}`);
        }

        this.activeGroupCalls.set(groupId, {
          groupId,
          groupName: group?.name || 'Grup',
          initiatorName: data.userName || 'Peserta',
          mediaType: data.mediaType || 'AUDIO',
          startedAt: new Date(),
          callSessionId,
        });

        // Broadcast group_call:started to group room (users currently viewing this group)
        this.server.to(`group_${groupId}`).emit('group_call:started', {
          groupId,
          groupName: group?.name || 'Grup',
          initiatorName: data.userName || 'Peserta',
          mediaType: data.mediaType || 'AUDIO',
          participantsCount: 1,
        });

        // Notify all group members (for toast alerts across the app)
        try {
          const members = await this.prisma.groupMember.findMany({
            where: { group_id: groupId },
            select: { user_id: true },
          });
          members.forEach((m) => {
            if (m.user_id !== userId) {
              this.server.to(`user_${m.user_id}`).emit('group_call:notification', {
                groupId,
                groupName: group?.name || 'Grup',
                initiatorName: data.userName || 'Peserta',
                mediaType: data.mediaType || 'AUDIO',
                participantsCount: 1,
              });
            }
          });
        } catch (err: any) {
          this.logger.debug(`Error fetching group members for call alert: ${err.message}`);
        }

        // Post chat notice message into group stream
        try {
          const startMsg = await this.prisma.groupMessage.create({
            data: {
              group_id: groupId,
              sender_id: userId,
              content: `📞 ${data.userName || 'Peserta'} memulai panggilan ${data.mediaType === 'VIDEO' ? 'video' : 'suara'} grup.`,
            },
            include: {
              sender: {
                select: { id: true, email: true, biodata: true },
              },
            },
          });
          this.server.to(`group_${groupId}`).emit('group_message', startMsg);
        } catch (e: any) {
          this.logger.debug(`Error sending group call start message: ${e.message}`);
        }
      } else {
        // Subsequent participant joined -> update active call counter for group room
        const active = this.activeGroupCalls.get(groupId);
        this.server.to(`group_${groupId}`).emit('group_call:status_updated', {
          groupId,
          isActive: true,
          participantsCount: participants.size,
          mediaType: active?.mediaType || data.mediaType || 'AUDIO',
          initiatorName: active?.initiatorName || 'Peserta',
        });
      }

      // Return existing participants to new joiner
      const existingList = Array.from(participants.entries())
        .filter(([sockId]) => sockId !== client.id)
        .map(([sockId, info]) => ({
          socketId: sockId,
          userId: info.userId,
          userName: info.userName,
          mediaType: info.mediaType,
        }));

      // Broadcast to other participants in call that someone joined
      client.to(`group_call_${groupId}`).emit('group_call:user_joined', {
        socketId: client.id,
        userId,
        userName: data.userName || 'Peserta',
        mediaType: data.mediaType || 'AUDIO',
        participantsCount: participants.size,
      });

      return {
        participants: existingList,
        participantsCount: participants.size,
      };
    } catch (err: any) {
      this.logger.error(`Error in handleGroupCallJoin: ${err.message}`);
      client.emit('group_call:error', { message: 'Gagal bergabung ke panggilan grup.' });
      return { error: 'SERVER_ERROR' };
    }
  }

  @SubscribeMessage('group_call:get_active')
  handleGetActiveGroupCall(@MessageBody() data: { groupId: number | string }) {
    const groupId = data?.groupId ? Number(data.groupId) : null;
    if (!groupId) return { isActive: false };

    const active = this.activeGroupCalls.get(groupId);
    const participants = this.groupCallParticipants.get(groupId);
    if (active && participants && participants.size > 0) {
      return {
        isActive: true,
        groupId,
        groupName: active.groupName,
        initiatorName: active.initiatorName,
        mediaType: active.mediaType,
        participantsCount: participants.size,
      };
    }
    return { isActive: false, groupId };
  }

  @SubscribeMessage('group_call:signal')
  async handleGroupCallSignal(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { targetSocketId: string; signal: any },
  ) {
    try {
      const user = this.getClientUser(client);
      const senderId = user?.userId ? Number(user.userId) : null;
      if (!data.targetSocketId) return;

      this.server.to(data.targetSocketId).emit('group_call:signal', {
        senderSocketId: client.id,
        senderUserId: senderId,
        signal: data.signal,
      });
    } catch (err: any) {
      this.logger.debug(`Error in handleGroupCallSignal: ${err.message}`);
    }
  }

  @SubscribeMessage('group_call:leave')
  async handleGroupCallLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: number | string },
  ) {
    try {
      const user = this.getClientUser(client);
      const userId = user?.userId ? Number(user.userId) : null;
      const groupId = data.groupId ? Number(data.groupId) : null;
      if (!groupId) return;

      await client.leave(`group_call_${groupId}`);
      await this.cleanupGroupCallParticipant(groupId, client.id, userId);

      return { status: 'left' };
    } catch (err: any) {
      this.logger.error(`Error in handleGroupCallLeave: ${err.message}`);
      return { error: 'SERVER_ERROR' };
    }
  }
}
