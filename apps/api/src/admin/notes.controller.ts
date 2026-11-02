import { Body, Param, Post, Res } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { IsUUID } from 'class-validator';
import { NotesService } from '../pages/notes.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { parseForm } from './forms.js';

class NoteForm {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  text!: string;
}

class ChecklistItemParams extends WorkspaceItemParams {
  @IsUUID()
  blockId!: string;
}

class AppendForm {
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  text!: string;
}

@AdminController('admin/workspaces/:workspaceId')
export class NotesAdminController {
  constructor(private readonly notes: NotesService) {}

  @Post('notes')
  async create(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const { value, ok } = await parseForm(NoteForm, body);
    if (!ok) return this.rejected(res);
    const page = await this.notes.create(workspaceId, user.id, value);
    return res.redirect(`/admin/workspaces/${workspaceId}/pages/${page.id}?flash=created`);
  }

  @Post('pages/:id/note')
  async append(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const { value, ok } = await parseForm(AppendForm, body);
    if (!ok) return this.rejected(res);
    await this.notes.append(workspaceId, id, value.text);
    return res.redirect(`/admin/workspaces/${workspaceId}/pages/${id}?tab=note&flash=updated`);
  }

  @Post('pages/:id/checklist')
  async addItems(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const { value, ok } = await parseForm(AppendForm, body);
    if (!ok) return this.rejected(res);
    await this.notes.addItems(workspaceId, id, value.text);
    return res.redirect(`/admin/workspaces/${workspaceId}/pages/${id}?tab=checklist&flash=updated`);
  }

  @Post('pages/:id/checklist/:blockId/toggle')
  async toggleItem(
    @Param() { workspaceId, id, blockId }: ChecklistItemParams,
    @Res() res: Response,
  ) {
    await this.notes.toggleItem(workspaceId, id, blockId);
    return res.redirect(`/admin/workspaces/${workspaceId}/pages/${id}?tab=checklist`);
  }

  @Post('pages/:id/checklist/:blockId/delete')
  async removeItem(
    @Param() { workspaceId, id, blockId }: ChecklistItemParams,
    @Res() res: Response,
  ) {
    await this.notes.removeItem(workspaceId, id, blockId);
    return res.redirect(`/admin/workspaces/${workspaceId}/pages/${id}?tab=checklist&flash=deleted`);
  }

  private rejected(res: Response) {
    return res.status(400).render('admin/error', {
      title: 'Error 400',
      status: 400,
      message: 'The note is empty or longer than 20000 characters.',
    });
  }
}
