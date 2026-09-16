import { Module } from '@nestjs/common';
import { RegionsService } from './regions.service';
import { RegionsController } from './controllers/v1/regions.controller';
import { PrismaModule } from '@common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RegionsController],
  providers: [RegionsService],
  exports: [RegionsService],
})
export class RegionsModule {}
