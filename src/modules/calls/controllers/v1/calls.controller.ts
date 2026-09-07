import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CallsService } from '../../calls.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { GetUser } from '@common/decorators/get-user.decorator';

@ApiTags('Voice Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'calls', version: '1' })
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get('history')
  @ApiOperation({ summary: 'Get user voice call logs (FR-CALL-05)' })
  async getCallHistory(@GetUser('userId') userId: number) {
    return this.callsService.getCallHistory(userId);
  }
}
