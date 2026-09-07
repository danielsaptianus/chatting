import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber } from 'class-validator';

export class LinkGroupDto {
  @ApiProperty({ example: 1, description: 'ID of existing group to link into community' })
  @IsNumber()
  @IsNotEmpty()
  groupId: number;
}
