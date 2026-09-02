import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@common/prisma/prisma.service';
import { PasswordUtil } from '@common/utils/password.util';
import { LoginDto } from './core/dto/login.dto';
import { RequestResetPasswordDto } from './core/dto/request-reset-password.dto';
import { ResetPasswordDto } from './core/dto/reset-password.dto';
import { JwtPayload } from './core/interfaces/jwt-payload.interface';
import { randomBytes } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findFirst({
      where: {
        email,
        deleted_at: null,
      },
      include: {
        biodata: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.biodata || !user.biodata.is_active) {
      throw new UnauthorizedException('User account is inactive or missing profile');
    }

    const isPasswordValid = await PasswordUtil.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.biodata.role,
      first_name: user.biodata.first_name,
      last_name: user.biodata.last_name,
    };

    const access_token = this.jwtService.sign(payload);

    return {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        biodata: {
          first_name: user.biodata.first_name,
          last_name: user.biodata.last_name,
          role: user.biodata.role,
          is_active: user.biodata.is_active,
        },
      },
    };
  }

  async requestResetPassword(dto: RequestResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deleted_at: null },
    });

    if (!user) {
      // Don't leak user existence
      return { message: 'If the email exists, a reset token has been generated.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token,
        expires_at: expiresAt,
      },
    });

    return {
      message: 'Reset token generated successfully',
      reset_token: token, // Returned for API convenience
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const resetRecord = await this.prisma.passwordResetToken.findUnique({
      where: { token: dto.token },
      include: { user: true },
    });

    if (!resetRecord || resetRecord.used) {
      throw new BadRequestException('Invalid or used reset token');
    }

    if (resetRecord.expires_at < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    const hashedPassword = await PasswordUtil.hash(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetRecord.user_id },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { used: true },
      }),
    ]);

    return { message: 'Password updated successfully' };
  }
}
