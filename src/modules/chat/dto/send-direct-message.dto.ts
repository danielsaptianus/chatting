import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsString } from 'class-validator';

export class SendDirectMessageDto {
  @ApiProperty({ example: 2 })
  @IsInt()
  @IsNotEmpty()
  receiverId: number;

  @ApiProperty({ example: 'Halo bro, opo kabar?' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
