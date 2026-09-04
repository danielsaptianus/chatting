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
import { ChatService } from '../../chat.service';
import { CreateGroupDto } from '../../dto/create-group.dto';
import { AddGroupMemberDto } from '../../dto/add-group-member.dto';
import { SendGroupMessageDto } from '../../dto/send-group-message.dto';
import { SendDirectMessageDto } from '../../dto/send-direct-message.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { GetUser } from '@common/decorators/get-user.decorator';

@ApiTags('Chatting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'chat', version: '1' })
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ==========================================
  // GROUP CHAT ENDPOINTS
  // ==========================================

  @Post('groups')
  @ApiOperation({ summary: 'Create a new group' })
  async createGroup(
    @GetUser('userId') userId: number,
    @Body() dto: CreateGroupDto,
  ) {
    return this.chatService.createGroup(userId, dto);
  }

  @Get('groups')
  @ApiOperation({ summary: 'Get groups I belong to' })
  async getMyGroups(@GetUser('userId') userId: number) {
    return this.chatService.getMyGroups(userId);
  }

  @Get('groups/all')
  @ApiOperation({ summary: 'Get all groups (Admin only)' })
  async getAllGroups(@GetUser('userId') userId: number) {
    return this.chatService.getAllGroups(userId);
  }

  @Get('groups/invite/:code')
  @ApiOperation({ summary: 'Preview group by invite code' })
  async previewGroupByInvite(@Param('code') code: string) {
    return this.chatService.previewGroupByInvite(code);
  }

  @Post('groups/invite/:code/request')
  @ApiOperation({ summary: 'Request to join group via invite code' })
  async requestJoinByInvite(
    @GetUser('userId') userId: number,
    @Param('code') code: string,
  ) {
    return this.chatService.requestJoinByInvite(userId, code);
  }

  @Get('groups/:id/invite-code')
  @ApiOperation({ summary: 'Get group invite code (Owner/Admin only)' })
  async getInviteCode(
    @GetUser('userId') currentUserId: number,
    @Param('id', ParseIntPipe) groupId: number,
  ) {
    return this.chatService.getInviteCode(currentUserId, groupId);
  }

  @Post('groups/:id/revoke-invite')
  @ApiOperation({ summary: 'Revoke and regenerate group invite code (Owner/Admin only)' })
  async revokeInviteCode(
    @GetUser('userId') currentUserId: number,
    @Param('id', ParseIntPipe) groupId: number,
  ) {
    return this.chatService.revokeInviteCode(currentUserId, groupId);
  }

  @Post('groups/:id/members')
  @ApiOperation({ summary: 'Add a user to a group' })
  async addMember(
    @GetUser('userId') currentUserId: number,
    @Param('id', ParseIntPipe) groupId: number,
    @Body() dto: AddGroupMemberDto,
  ) {
    return this.chatService.addMember(currentUserId, groupId, dto);
  }

  @Post('groups/:id/join')
  @ApiOperation({ summary: 'Request to join a group' })
  async joinGroup(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) groupId: number,
  ) {
    return this.chatService.joinGroup(userId, groupId);
  }

  @Post('groups/:id/join-request')
  @ApiOperation({ summary: 'Submit a request to join a group' })
  async requestJoinGroup(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) groupId: number,
  ) {
    return this.chatService.requestJoinGroup(userId, groupId);
  }

  @Get('groups/:id/join-requests')
  @ApiOperation({ summary: 'Get pending join requests for a group (Owner/Admin)' })
  async getJoinRequests(
    @GetUser('userId') currentUserId: number,
    @Param('id', ParseIntPipe) groupId: number,
  ) {
    return this.chatService.getJoinRequests(currentUserId, groupId);
  }

  @Post('groups/:id/join-requests/:requestId/approve')
  @ApiOperation({ summary: 'Approve a join request (Owner/Admin)' })
  async approveJoinRequest(
    @GetUser('userId') currentUserId: number,
    @Param('id', ParseIntPipe) groupId: number,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    return this.chatService.approveJoinRequest(currentUserId, groupId, requestId);
  }

  @Post('groups/:id/join-requests/:requestId/reject')
  @ApiOperation({ summary: 'Reject a join request (Owner/Admin)' })
  async rejectJoinRequest(
    @GetUser('userId') currentUserId: number,
    @Param('id', ParseIntPipe) groupId: number,
    @Param('requestId', ParseIntPipe) requestId: number,
  ) {
    return this.chatService.rejectJoinRequest(currentUserId, groupId, requestId);
  }

  @Delete('groups/:id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from group (Owner/Admin or Self)' })
  async removeMember(
    @GetUser('userId') currentUserId: number,
    @Param('id', ParseIntPipe) groupId: number,
    @Param('userId', ParseIntPipe) targetUserId: number,
  ) {
    return this.chatService.removeMember(currentUserId, groupId, targetUserId);
  }

  @Post('groups/:id/messages')
  @ApiOperation({ summary: 'Send message to group' })
  async sendGroupMessage(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) groupId: number,
    @Body() dto: SendGroupMessageDto,
  ) {
    return this.chatService.sendGroupMessage(userId, groupId, dto);
  }

  @Get('groups/:id/messages')
  @ApiOperation({ summary: 'Get group message history' })
  async getGroupMessages(
    @GetUser('userId') userId: number,
    @Param('id', ParseIntPipe) groupId: number,
  ) {
    return this.chatService.getGroupMessages(userId, groupId);
  }

  // ==========================================
  // PERSONAL CHAT (PC) ENDPOINTS
  // ==========================================

  @Post('pc/messages')
  @ApiOperation({ summary: 'Send direct message (PC)' })
  async sendDirectMessage(
    @GetUser('userId') senderId: number,
    @Body() dto: SendDirectMessageDto,
  ) {
    return this.chatService.sendDirectMessage(senderId, dto);
  }

  @Get('pc/conversations')
  @ApiOperation({ summary: 'List recent DM contacts/conversations' })
  async getConversations(@GetUser('userId') userId: number) {
    return this.chatService.getConversations(userId);
  }

  @Get('pc/:userId/messages')
  @ApiOperation({ summary: 'Get direct chat message history with a user' })
  async getDirectMessages(
    @GetUser('userId') userId: number,
    @Param('userId', ParseIntPipe) otherUserId: number,
  ) {
    return this.chatService.getDirectMessages(userId, otherUserId);
  }
}
