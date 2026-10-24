import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Size of the Markdown text itself, in bytes; the JSON body may be somewhat bigger because of escaping. */
export const MAX_MARKDOWN_BYTES = 1_000_000;

export class ImportMarkdownDto {
  @IsString()
  markdown!: string;

  /** Overrides the title; without it a leading `# ` line is the title. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
