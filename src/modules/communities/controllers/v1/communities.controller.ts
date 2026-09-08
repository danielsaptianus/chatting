import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommunitiesService } from '../../communities.service';
import { CreateCommunityDto } from '../../dto/create-community.dto';
import { LinkGroupDto } from '../../dto/link-group.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { GetUser } from '@common/decorators/get-user.decorator';

@ApiTags('Communities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'communities', version: '1' })
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new community (FR-COM-01 & FR-COM-02)' })
  async createCommunity(
    @GetUser('userId') userId: number,
    @Body() dto: CreateCommunityDto,
  ) {
    return this.communitiesService.createCommunity(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get communities I belong to' })
  async getMyCommunities(@GetUser('userId') userId: number) {
    return this.communitiesService.getMyCommunities(userId);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all communities for exploration' })
  async getAllCommunities(@GetUser('userId') userId: number) {
    return this.communitiesService.getAllCommunities(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get community details' })
  async getCommunityDetails(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) communityId: number,
  ) {
    return this.communitiesService.getCommunityDetails(communityId, userId);
  }

  @Post(':id/join')
  @ApiOperation({ summary: 'Join a community' })
  async joinCommunity(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) communityId: number,
  ) {
    return this.communitiesService.joinCommunity(communityId, userId);
  }

  @Post(':id/groups')
  @ApiOperation({ summary: 'Link group to community (FR-COM-03)' })
  async linkGroup(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) communityId: number,
    @Body() dto: LinkGroupDto,
  ) {
    return this.communitiesService.linkGroup(communityId, userId, dto);
  }

  @Get(':id/groups')
  @ApiOperation({ summary: 'Get sub-groups of community (FR-COM-04)' })
  async getCommunityGroups(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) communityId: number,
  ) {
    return this.communitiesService.getCommunityGroups(communityId, userId);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove member from community and all linked sub-groups (FR-COM-05)' })
  async removeMember(
    @GetUser('userId') adminUserId: number,
    @Param('id', ParseIntPipe) communityId: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
  ) {
    return this.communitiesService.removeMember(communityId, adminUserId, targetUserId);
  }
}
