import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from '../../users.service';
import { CreateUserDto } from '../../core/dto/create-user.dto';
import { UpdateUserDto } from '../../core/dto/update-user.dto';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { GetUser } from '@common/decorators/get-user.decorator';
import { Role } from '@prisma/client';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Register a new user (Admin only)' })
  async createUserByAdmin(@Body() dto: CreateUserDto) {
    return this.usersService.createUserByAdmin(dto);
  }

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'List all users (Admin only)' })
  @ApiQuery({ name: 'includeDeleted', required: false, type: Boolean })
  async findAll(@Query('includeDeleted') includeDeleted?: string) {
    return this.usersService.findAll(includeDeleted === 'true');
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@GetUser('userId') userId: number) {
    return this.usersService.findOne(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user detail by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user detail (Admin or self)' })
  async update(
    @GetUser() currentUser: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    // Only admin or the user themselves can update
    const userRole = currentUser.role || currentUser.biodata?.role;
    if (userRole !== Role.ADMIN && currentUser.userId !== id) {
      throw new ForbiddenException('You can only update your own profile');
    }

    return this.usersService.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a user (Admin only)' })
  async softDelete(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.softDelete(id);
  }
}
