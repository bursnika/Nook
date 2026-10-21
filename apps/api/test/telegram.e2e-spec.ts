import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { env } from '../src/env.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TELEGRAM_PROVIDER, type TelegramProvider } from '../src/telegram/telegram.provider.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { bearer } from './auth-helpers.js';
import { resetDb } from './helpers.js';

class FakeTelegram implements TelegramProvider {
  configured = true;
  sent: { chatId: string; text: string }[] = [];
  async sendMessage(chatId: string, text: string) {
    this.sent.push({ chatId, text });
  }
  async getUpdates() {
    return [];
  }
}

describe('Telegram bot', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let telegram: FakeTelegram;
  let service: TelegramService;
  let token: string;
  let userId: string;
  let wsId: string;

  beforeAll(async () => {
    telegram = new FakeTelegram();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TELEGRAM_PROVIDER)
      .useValue(telegram)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(TelegramService);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(prisma);
    telegram.sent = [];
    telegram.configured = true;
    const user = await prisma.user.create({ data: { email: 'tg@example.com', name: 'Tg' } });
    userId = user.id;
    const ws = await prisma.workspace.create({
      data: { name: 'Home', slug: 'home', memberships: { create: { userId, role: 'OWNER' } } },
    });
    wsId = ws.id;
    token = await bearer(app, user);
  });

  const http = () => request(app.getHttpServer());
  const startLink = async (chatId = '555') => {
    const { body } = await http()
      .post('/api/telegram/link')
      .set('Authorization', token)
      .expect(200);
    await service.handle({ chatId, text: `/start ${body.code}` });
    return body.code as string;
  };

  it('reports whether the bot is configured and linked', async () => {
    const before = await http().get('/api/telegram').set('Authorization', token).expect(200);
    expect(before.body).toMatchObject({ configured: true, linked: false });
    await startLink();
    const after = await http().get('/api/telegram').set('Authorization', token).expect(200);
    expect(after.body.linked).toBe(true);
  });

  it('links the chat with a one-time code and confirms in the chat', async () => {
    const code = await startLink('555');
    expect(await prisma.telegramLink.findUnique({ where: { userId } })).toMatchObject({
      chatId: '555',
    });
    expect(telegram.sent.at(-1)?.text).toMatch(/Linked/);
    // the code cannot be used again, for another chat or at all
    await service.handle({ chatId: '777', text: `/start ${code}` });
    expect(telegram.sent.at(-1)).toMatchObject({ chatId: '777' });
    expect(telegram.sent.at(-1)?.text).toMatch(/expired/);
    expect(await prisma.telegramLink.count()).toBe(1);
  });

  it('rejects an unknown code and an unlinked chat', async () => {
    await service.handle({ chatId: '1', text: '/start nonsense' });
    expect(telegram.sent.at(-1)?.text).toMatch(/expired/);
    await service.handle({ chatId: '1', text: '/today' });
    expect(telegram.sent.at(-1)?.text).toMatch(/not linked/);
    expect(await prisma.telegramLink.count()).toBe(0);
  });

  it("answers /today with the plan from all of the person's workspaces only", async () => {
    await startLink();
    const now = new Date();
    const stranger = await prisma.workspace.create({
      data: { name: 'Not mine', slug: 'not-mine' },
    });
    await prisma.task.createMany({
      data: [
        { workspaceId: wsId, title: 'Due today', dueDate: now },
        { workspaceId: wsId, title: 'Finished', status: 'DONE', dueDate: now },
        { workspaceId: stranger.id, title: 'Secret', dueDate: now },
      ],
    });
    await prisma.calendarEvent.create({
      data: {
        workspaceId: wsId,
        title: 'Lunch',
        startsAt: now,
        endsAt: new Date(now.getTime() + 3_600_000),
      },
    });
    await service.handle({ chatId: '555', text: '/today' });
    const text = telegram.sent.at(-1)!.text;
    expect(text).toMatch(/Due today by \d\d:\d\d \(Home\)/);
    expect(text).toContain('Lunch (Home)');
    expect(text).not.toContain('Finished');
    expect(text).not.toContain('Secret');
  });

  it('sends the morning plan once a day, after the digest hour', async () => {
    await startLink();
    telegram.sent = [];
    const day = '2030-03-04';
    const early = new Date(`${day}T00:00:00Z`);
    const late = new Date(`${day}T${String(env.telegram.digestHourUtc).padStart(2, '0')}:30:00Z`);
    if (env.telegram.digestHourUtc > 0) expect(await service.sendDueDigests(early)).toBe(0);
    expect(await service.sendDueDigests(late)).toBe(1);
    expect(await service.sendDueDigests(late)).toBe(0);
    expect(telegram.sent).toHaveLength(1);
    expect(telegram.sent[0].text).toContain(`Your plan for ${day}`);
    // the next day it goes out again
    expect(await service.sendDueDigests(new Date(late.getTime() + 24 * 3_600_000))).toBe(1);
  });

  it('unlinks from the chat and from the app', async () => {
    await startLink();
    await service.handle({ chatId: '555', text: '/unlink' });
    expect(await prisma.telegramLink.count()).toBe(0);
    await startLink();
    await http().delete('/api/telegram').set('Authorization', token).expect(204);
    expect(await prisma.telegramLink.count()).toBe(0);
  });

  it('is off without a bot token', async () => {
    telegram.configured = false;
    await http().post('/api/telegram/link').set('Authorization', token).expect(503);
    await http().get('/api/telegram').expect(401);
  });
});
