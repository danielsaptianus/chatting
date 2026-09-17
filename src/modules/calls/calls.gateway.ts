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

  // In-memory track group call participants: groupId -> Map of { socketId => { userId, userName, mediaType } }
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

  handleDisconnect(client: Socket) {
    // Check if client was in any group calls and clean up
    this.groupCallParticipants.forEach((participants, groupId) => {
      if (participants.has(client.id)) {
        const info = participants.get(client.id);
        participants.delete(client.id);
        this.logger.log(`Client ${client.id} (User ${info?.userId}) left group_call_${groupId}`);

        this.server.to(`group_call_${groupId}`).emit('group_call:user_left', {
          userId: info?.userId,
          socketId: client.id,
          participantsCount: participants.size,
        });
        this.server.to(`group_${groupId}`).emit('group_call:user_left', {
          userId: info?.userId,
          socketId: client.id,
          participantsCount: participants.size,
        });
      }
    });
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
        select: { id: true, region_id: true },
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

      // Register participant
      participants.set(client.id, {
        userId,
        userName: data.userName || 'Peserta',
        mediaType: data.mediaType || 'AUDIO',
      });

      // Join socket room
      await client.join(`group_call_${groupId}`);

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

      const participants = this.groupCallParticipants.get(groupId);
      if (participants) {
        participants.delete(client.id);
        await client.leave(`group_call_${groupId}`);

        this.server.to(`group_call_${groupId}`).emit('group_call:user_left', {
          socketId: client.id,
          userId,
          participantsCount: participants.size,
        });
      }

      return { status: 'left' };
    } catch (err: any) {
      this.logger.error(`Error in handleGroupCallLeave: ${err.message}`);
      return { error: 'SERVER_ERROR' };
    }
  }
}
