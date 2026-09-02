import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './controllers/v1/chat.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
