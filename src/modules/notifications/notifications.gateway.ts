import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: 'ws',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn(`Client ${client.id} connected without token.`);
        return;
      }

      const payload = this.jwtService.verify(token);
      client.data.user = payload;

      // Join user's private notification channel room
      const userRoom = `user_${payload.userId}`;
      await client.join(userRoom);
      this.logger.log(`Client ${client.id} (User ${payload.userId}) connected and joined ${userRoom}`);
    } catch (err: any) {
      this.logger.error(`Handshake failed for client ${client.id}: ${err.message}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client ${client.id} disconnected`);
  }

  @SubscribeMessage('join_group')
  async handleJoinGroup(
    @MessageBody() data: { groupId: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.groupId) {
      const groupRoom = `group_${data.groupId}`;
      await client.join(groupRoom);
      return { event: 'joined_group_room', groupRoom };
    }
  }

  @SubscribeMessage('leave_group')
  async handleLeaveGroup(
    @MessageBody() data: { groupId: number },
    @ConnectedSocket() client: Socket,
  ) {
    if (data?.groupId) {
      const groupRoom = `group_${data.groupId}`;
      await client.leave(groupRoom);
      return { event: 'left_group_room', groupRoom };
    }
  }

  sendToUser(userId: number, event: string, payload: any) {
    if (this.server) {
      this.server.to(`user_${userId}`).emit(event, payload);
    }
  }

  sendToGroup(groupId: number, event: string, payload: any) {
    if (this.server) {
      this.server.to(`group_${groupId}`).emit(event, payload);
    }
  }

  broadcast(event: string, payload: any) {
    if (this.server) {
      this.server.emit(event, payload);
    }
  }
}
