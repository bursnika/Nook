import {
  Body,
  Get,
  Param,
  Post,
  Query,
  Render,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { UpdateAttachmentDto, UploadAttachmentDto } from '../attachments/attachment.dto.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import { uploadOptions } from '../attachments/upload.config.js';
import { WorkspaceItemParams, WorkspaceParams } from '../common/params.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';
import { AdminController } from './admin-controller.decorator.js';
import { AdminListQuery } from './admin-query.js';
import { flashMessage, PAGE_SIZE, pager, parseForm, toFormMessage } from './forms.js';
import { LookupService } from './lookup.service.js';

@AdminController('admin/workspaces/:workspaceId/attachments')
export class AttachmentsAdminController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly workspaces: WorkspacesService,
    private readonly lookup: LookupService,
  ) {}

  @Get()
  @Render('admin/attachments/index')
  async index(
    @Param() { workspaceId }: WorkspaceParams,
    @Query() { page, q, flash }: AdminListQuery,
    @Req() req: Request,
  ) {
    const ws = await this.workspaces.get(workspaceId);
    const { items, total } = await this.attachments.list(workspaceId, {
      q,
      skip: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
    });
    return {
      title: 'Attachments',
      section: 'attachments',
      ws,
      flash: flashMessage(flash),
      q,
      attachments: items,
      pager: pager(req, total, page),
    };
  }

  @Get('new')
  @Render('admin/attachments/form')
  newForm(@Param() { workspaceId }: WorkspaceParams) {
    return this.formView(workspaceId, {
      title: 'Upload a file',
      action: `/admin/workspaces/${workspaceId}/attachments`,
      isNew: true,
    });
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async create(
    @Param() { workspaceId }: WorkspaceParams,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res() res: Response,
  ) {
    const view = {
      title: 'Upload a file',
      action: `/admin/workspaces/${workspaceId}/attachments`,
      isNew: true,
      form: body,
    };
    const { value, errors, ok } = await parseForm(UploadAttachmentDto, body);
    if (!ok || !file) {
      const withFile = file ? errors : { ...errors, file: 'Choose a file to upload.' };
      if (file) await this.attachments.discardUpload(file);
      return res
        .status(400)
        .render(
          'admin/attachments/form',
          await this.formView(workspaceId, { ...view, errors: withFile }),
        );
    }
    try {
      const created = await this.attachments.create(workspaceId, file, value);
      return res.redirect(
        `/admin/workspaces/${workspaceId}/attachments/${created.id}?flash=created`,
      );
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/attachments/form', await this.formView(workspaceId, { ...view, formError }));
    }
  }

  @Get(':id')
  @Render('admin/attachments/show')
  async show(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Query() { flash }: AdminListQuery,
  ) {
    const [ws, attachment] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.attachments.get(workspaceId, id),
    ]);
    const [page] = await this.lookup.pageOption(workspaceId, attachment.pageId);
    return {
      title: attachment.filename,
      section: 'attachments',
      ws,
      flash: flashMessage(flash),
      attachment,
      page,
    };
  }

  @Get(':id/edit')
  async editForm(@Param() { workspaceId, id }: WorkspaceItemParams, @Res() res: Response) {
    const attachment = await this.attachments.get(workspaceId, id);
    return res.render(
      'admin/attachments/form',
      await this.formView(workspaceId, {
        title: `Edit ${attachment.filename}`,
        action: `/admin/workspaces/${workspaceId}/attachments/${id}`,
        form: attachment as unknown as Record<string, unknown>,
      }),
    );
  }

  @Post(':id')
  async update(
    @Param() { workspaceId, id }: WorkspaceItemParams,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const attachment = await this.attachments.get(workspaceId, id);
    const view = {
      title: `Edit ${attachment.filename}`,
      action: `/admin/workspaces/${workspaceId}/attachments/${id}`,
      form: body,
    };
    const { value, errors, ok } = await parseForm(UpdateAttachmentDto, body, {
      nullable: ['pageId'],
    });
    if (!ok)
      return res
        .status(400)
        .render('admin/attachments/form', await this.formView(workspaceId, { ...view, errors }));
    try {
      await this.attachments.update(workspaceId, id, value);
      return res.redirect(`/admin/workspaces/${workspaceId}/attachments/${id}?flash=updated`);
    } catch (error) {
      const formError = toFormMessage(error);
      if (!formError) throw error;
      return res
        .status(400)
        .render('admin/attachments/form', await this.formView(workspaceId, { ...view, formError }));
    }
  }

  @Post(':id/delete')
  async remove(@Param() { workspaceId, id }: WorkspaceItemParams, @Res() res: Response) {
    await this.attachments.remove(workspaceId, id);
    return res.redirect(`/admin/workspaces/${workspaceId}/attachments?flash=deleted`);
  }

  private async formView(
    workspaceId: string,
    view: {
      title: string;
      action: string;
      isNew?: boolean;
      form?: Record<string, unknown>;
      errors?: Record<string, string>;
      formError?: string;
    },
  ) {
    const form = view.form ?? {};
    const [ws, pages] = await Promise.all([
      this.workspaces.get(workspaceId),
      this.lookup.pageOption(workspaceId, form.pageId),
    ]);
    return { ...view, section: 'attachments', ws, form, errors: view.errors ?? {}, pages };
  }
}
