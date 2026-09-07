import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCommunityDto {
  @ApiProperty({ example: 'Komunitas Pengembang Web' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Wadah silaturahmi & diskusi pengembang web', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}
