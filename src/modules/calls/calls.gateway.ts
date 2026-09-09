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
import { CallStatus, CallType } from '@prisma/client';

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
    Map<string, { userId: number; userName: string }>
  >();

  // Track pending 1-on-1 call timeouts: callId -> NodeJS.Timeout (BR-CALL-01: 30s ring limit)
  private callTimeouts = new Map<number, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly callsService: CallsService,
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

  @SubscribeMessage('call:initiate')
  async handleCallInitiate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId: number; callerName: string },
  ) {
    const callerId = client.data?.user?.userId;
    if (!callerId || !data.receiverId) return;

    const callSession = await this.callsService.initiateCall({
      callerId,
      receiverId: data.receiverId,
      callType: CallType.DIRECT,
    });

    // Notify receiver with incoming call event & ringing
    this.server.to(`user_${data.receiverId}`).emit('call:incoming', {
      callId: callSession.id,
      callerId,
      callerName: data.callerName || 'Pengguna',
      callType: 'DIRECT',
    });

    // BR-CALL-01: 30 seconds ring timeout -> auto mark as MISSED if unanswered
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

    return { callId: callSession.id };
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
  // GROUP VOICE CALL (FR-CALL-02 - MAX 8 PARTICIPANTS)
  // ==========================================

  @SubscribeMessage('group_call:join')
  async handleGroupCallJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { groupId: number; userName: string },
  ) {
    const userId = client.data?.user?.userId;
    if (!userId || !data.groupId) return;

    if (!this.groupCallParticipants.has(data.groupId)) {
      this.groupCallParticipants.set(data.groupId, new Map());
    }

    const participants = this.groupCallParticipants.get(data.groupId)!;

    // Check maximum 8 participants restriction (FR-CALL-02)
    if (participants.size >= 8 && !participants.has(client.id)) {
      client.emit('group_call:error', {
        message: 'Kapasitas panggilan suara grup penuh (maksimal 8 peserta).',
      });
      return { error: 'GROUP_CALL_FULL' };
    }

    // Register participant
    participants.set(client.id, { userId, userName: data.userName });

    // Join socket room
    await client.join(`group_call_${data.groupId}`);

    // Return existing participants to new joiner
    const existingList = Array.from(participants.entries())
      .filter(([sockId]) => sockId !== client.id)
      .map(([sockId, info]) => ({
        socketId: sockId,
        userId: info.userId,
        userName: info.userName,
      }));

    // Broadcast to other participants that someone joined
    client.to(`group_call_${data.groupId}`).emit('group_call:user_joined', {
      socketId: client.id,
      userId,
      userName: data.userName,
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
