import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 8000;

export class ChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_MESSAGE_CHARS)
  content!: string;
}

/** The whole conversation travels with every request: nothing is stored on the server. */
export class ChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_MESSAGES)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}
