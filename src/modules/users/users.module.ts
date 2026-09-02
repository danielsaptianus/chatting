import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './controllers/v1/users.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
