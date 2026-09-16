import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RegionsService } from '../../regions.service';
import { CreateRegionDto } from '../../core/dto/create-region.dto';
import { UpdateRegionDto } from '../../core/dto/update-region.dto';
import { AssignRegionAdminDto } from '../../core/dto/assign-admin.dto';
import { GetUser } from '@common/decorators/get-user.decorator';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '@common/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { JwtPayload } from '@modules/auth/core/interfaces/jwt-payload.interface';

@ApiTags('Regions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller({ path: 'regions', version: '1' })
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Super Admin: Membuat Region baru (FR-REG-01)' })
  create(@Body() dto: CreateRegionDto) {
    return this.regionsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Mendapatkan daftar Region (Super Admin melihat semua, User melihat miliknya)' })
  findAll(@GetUser() currentUser: JwtPayload) {
    return this.regionsService.findAll(currentUser);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail Region beserta daftar user, grup, dan komunitas' })
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @GetUser() currentUser: JwtPayload,
  ) {
    return this.regionsService.findOne(id, currentUser);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Super Admin: Memperbarui data Region' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRegionDto,
  ) {
    return this.regionsService.update(id, dto);
  }

  @Post(':id/assign-admin')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Super Admin: Menetapkan 1 Admin untuk Region (FR-REG-02, BR-TENANT-01)' })
  assignAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignRegionAdminDto,
  ) {
    return this.regionsService.assignAdmin(id, dto);
  }
}
