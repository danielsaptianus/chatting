import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CallsService } from './calls.service';
import { CallsGateway } from './calls.gateway';
import { CallsController } from './controllers/v1/calls.controller';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CallsController],
  providers: [CallsService, CallsGateway],
  exports: [CallsService, CallsGateway],
})
export class CallsModule {}
