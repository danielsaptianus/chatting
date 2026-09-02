import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Backend Developers' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Group for backend discussions', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}
