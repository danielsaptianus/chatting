import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsNotEmpty } from 'class-validator';

export class AddGroupMemberDto {
  @ApiProperty({ example: 2 })
  @IsInt()
  @IsNotEmpty()
  userId: number;
}
