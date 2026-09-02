import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token-string' })
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiProperty({ example: 'newpassword123' })
  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  newPassword: string;
}
