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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import { UsersService } from '../../users.service';
import { CreateUserDto } from '../../core/dto/create-user.dto';
import { UpdateUserDto } from '../../core/dto/update-user.dto';
import { UploadedAvatarFile } from '../../core/interfaces/avatar-file.interface';
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

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Post()
  @ApiOperation({ summary: 'Register a new user (Super Admin or Group Admin)' })
  async createUser(
    @GetUser() currentUser: any,
    @Body() dto: CreateUserDto,
  ) {
    return this.usersService.createUser(currentUser, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List users (Filtered by tenancy: Super Admin sees all, Group Admin sees group members)' })
  @ApiQuery({ name: 'includeDeleted', required: false, type: Boolean })
  async findAll(@GetUser() currentUser: any, @Query('includeDeleted') includeDeleted?: string) {
    return this.usersService.findAll(currentUser, includeDeleted === 'true');
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@GetUser('userId') userId: number) {
    return this.usersService.findOne(userId);
  }

  @Post('me/avatar')
  @ApiOperation({ summary: 'Upload user profile photo/avatar (Max 2MB, jpg/jpeg/png/webp)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('avatar', {
      limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
      fileFilter: (req, file, callback) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if (!allowedTypes.includes(file.mimetype)) {
          return callback(
            new BadRequestException(
              'Format file tidak didukung! Format yang diperbolehkan: .jpg, .jpeg, .png, .webp',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadAvatar(
    @GetUser('userId') userId: number,
    @UploadedFile() file: UploadedAvatarFile,
  ) {
    if (!file) {
      throw new BadRequestException('File avatar wajib diunggah.');
    }
    return this.usersService.updateAvatar(userId, file);
  }

  @Delete('me/avatar')
  @ApiOperation({ summary: 'Delete avatar and revert to initials' })
  async deleteAvatar(@GetUser('userId') userId: number) {
    return this.usersService.deleteAvatar(userId);
  }

  @Get(':id/public-profile')
  @ApiOperation({ summary: 'Get sanitized public profile card of a user' })
  async getPublicProfile(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.getPublicProfile(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user detail by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update user detail (Super Admin, Group Admin for members, or self)' })
  async update(
    @GetUser() currentUser: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(currentUser, id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete a user (Super Admin or Group Admin within group)' })
  async softDelete(
    @GetUser() currentUser: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.usersService.softDelete(currentUser, id);
  }
}
