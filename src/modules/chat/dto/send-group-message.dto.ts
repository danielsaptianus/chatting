import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SendGroupMessageDto {
  @ApiProperty({ example: 'Halo teman-teman!' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
