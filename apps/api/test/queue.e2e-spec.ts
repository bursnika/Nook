import type { INestApplication } from '@nestjs/common';
import { BadGatewayException, Logger } from '@nestjs/common';
import request from 'supertest';
import { encryptToken } from '../src/google-calendar/token-crypto.js';
import {
  CALENDAR_SCOPE,
  TASKS_SCOPE,
  type GoogleEvent,
} from '../src/google-calendar/google-calendar.provider.js';
import { GOOGLE_SYNC_QUEUE, GoogleSyncJobs } from '../src/google-calendar/google-sync.jobs.js';
import { InMemoryQueue } from '../src/queue/in-memory-queue.js';
import { MESSAGE_QUEUE } from '../src/queue/message-queue.js';
import { REMINDERS_QUEUE, RemindersService } from '../src/reminders/reminders.service.js';
import { TELEGRAM_PROVIDER, type TelegramProvider } from '../src/telegram/telegram.provider.js';
import { bearer, signIn } from './auth-helpers.js';
import { createTestApp, resetDb, seedWorkspace, type TestApp } from './helpers.js';

class FakeTelegram implements TelegramProvider {
  configured = true;
  sent: { chatId: string; text: string }[] = [];
  /** How many of the next sends fail. */
  failures = 0;
  async sendMessage(chatId: string, text: string) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('Telegram is down');
    }
    this.sent.push({ chatId, text });
  }
  async getUpdates() {
    return [];
  }
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('message queues', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let queue: InMemoryQueue;
  let telegram: FakeTelegram;
  let reminders: RemindersService;

  beforeAll(async () => {
    telegram = new FakeTelegram();
    ctx = await createTestApp({
      auth: 'real',
      customize: (builder) => builder.overrideProvider(TELEGRAM_PROVIDER).useValue(telegram),
    });
    app = ctx.app;
    queue = app.get<InMemoryQueue>(MESSAGE_QUEUE);
    reminders = app.get(RemindersService);
    Logger.overrideLogger(false);
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await queue.clear();
    await resetDb(ctx.prisma);
    telegram.sent = [];
    telegram.failures = 0;
    telegram.configured = true;
    ctx.googleCalendar.calendars.clear();
    ctx.googleCalendar.revokedByUser.clear();
  });

  const http = () => request(app.getHttpServer());
  const soon = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

  async function linkChat(userId: string, chatId = `chat-${userId.slice(-6)}`) {
    await ctx.prisma.telegramLink.create({ data: { userId, chatId } });
    return chatId;
  }
  const addTask = (
    workspaceId: string,
    title: string,
    data: {
      dueDate?: Date | null;
      assigneeId?: string;
      status?: 'TODO' | 'DONE';
      extra?: object;
    } = {},
  ) =>
    ctx.prisma.task.create({
      data: {
        title,
        workspaceId,
        dueDate: data.dueDate === undefined ? soon(10) : data.dueDate,
        assigneeId: data.assigneeId,
        status: data.status ?? 'TODO',
        ...data.extra,
      },
    });
  /** What the scheduler would do on one tick, followed by the consumer. */
  async function tick() {
    const published = await reminders.scheduleDue();
    await queue.flush();
    return published;
  }
  const hhmm = (date: Date) => date.toISOString().slice(11, 16);

  describe('task reminders', () => {
    it('reminds the assignee once, in the agreed format, and marks the task as reminded', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      const chat = await linkChat(user.id);
      const task = await addTask(workspace.id, 'Hand in lab 1', { assigneeId: user.id });

      expect(await tick()).toBe(1);
      expect(telegram.sent).toEqual([
        {
          chatId: chat,
          text: `⏰ Hand in lab 1 is due at ${hhmm(task.dueDate!)} (${workspace.name})`,
        },
      ]);
      const after = await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(after.reminderSentAt).toBeInstanceOf(Date);
      // marking it must not look like an edit of the task
      expect(after.updatedAt).toEqual(task.updatedAt);

      // later ticks find nothing new
      expect(await tick()).toBe(0);
      expect(telegram.sent).toHaveLength(1);
    });

    it('sends an unassigned task to the owner of the workspace', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      const member = await ctx.prisma.user.create({
        data: { email: 'member@example.com', name: 'Member' },
      });
      await ctx.prisma.membership.create({
        data: { userId: member.id, workspaceId: workspace.id, role: 'MEMBER' },
      });
      await linkChat(member.id, 'member-chat');
      const ownerChat = await linkChat(user.id, 'owner-chat');
      await addTask(workspace.id, 'Nobody owns this');

      await tick();
      expect(telegram.sent.map((m) => m.chatId)).toEqual([ownerChat]);
    });

    it('sends a task imported from Google to the person who imported it', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      const importer = await ctx.prisma.user.create({
        data: { email: 'importer@example.com', name: 'Importer' },
      });
      await ctx.prisma.membership.create({
        data: { userId: importer.id, workspaceId: workspace.id, role: 'MEMBER' },
      });
      await linkChat(user.id, 'owner-chat');
      const chat = await linkChat(importer.id, 'importer-chat');
      await addTask(workspace.id, 'From Google', { extra: { importedById: importer.id } });

      await tick();
      expect(telegram.sent.map((m) => m.chatId)).toEqual([chat]);
    });

    it('only picks open tasks due within the lead time that have not been reminded', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      const mine = { assigneeId: user.id };
      await addTask(workspace.id, 'in 5 minutes', { ...mine, dueDate: soon(5) });
      await addTask(workspace.id, 'in 29 minutes', { ...mine, dueDate: soon(29) });
      await addTask(workspace.id, 'in 2 hours', { ...mine, dueDate: soon(120) });
      await addTask(workspace.id, 'an hour ago', { ...mine, dueDate: soon(-60) });
      await addTask(workspace.id, 'no due date', { ...mine, dueDate: null });
      await addTask(workspace.id, 'already done', { ...mine, status: 'DONE' });
      await addTask(workspace.id, 'already reminded', {
        ...mine,
        extra: { reminderSentAt: new Date() },
      });

      await tick();
      expect(telegram.sent.map((m) => m.text.split(' is due')[0]).sort()).toEqual([
        '⏰ in 29 minutes',
        '⏰ in 5 minutes',
      ]);
    });

    it('skips people without a linked Telegram chat, and does not fall back to someone else', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      const assignee = await ctx.prisma.user.create({
        data: { email: 'quiet@example.com', name: 'Quiet' },
      });
      await ctx.prisma.membership.create({
        data: { userId: assignee.id, workspaceId: workspace.id, role: 'MEMBER' },
      });
      await linkChat(user.id); // the owner could be reached, but the task is the assignee's
      await addTask(workspace.id, 'Quiet one', { assigneeId: assignee.id });

      expect(await tick()).toBe(0);
      expect(telegram.sent).toEqual([]);
    });

    it('does nothing when no Telegram bot is configured', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      await addTask(workspace.id, 'Soon', { assigneeId: user.id });
      telegram.configured = false;
      expect(await tick()).toBe(0);
      expect(telegram.sent).toEqual([]);
    });

    it('reminds a rescheduled task again', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      const task = await addTask(workspace.id, 'Moves around', { assigneeId: user.id });
      await tick();
      expect(telegram.sent).toHaveLength(1);

      const newDue = soon(20);
      await http()
        .patch(`/api/workspaces/${workspace.id}/tasks/${task.id}`)
        .set('Authorization', await bearer(app, user))
        .send({ dueDate: newDue.toISOString() })
        .expect(200);
      expect(
        (await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt,
      ).toBeNull();

      await tick();
      expect(telegram.sent).toHaveLength(2);
      expect(telegram.sent[1].text).toContain(`due at ${hhmm(newDue)}`);
    });

    it('keeps the reminder when other fields change but not the due date', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      const task = await addTask(workspace.id, 'Stays', { assigneeId: user.id });
      await tick();
      await http()
        .patch(`/api/workspaces/${workspace.id}/tasks/${task.id}`)
        .set('Authorization', await bearer(app, user))
        .send({ title: 'Stays, renamed', dueDate: task.dueDate!.toISOString() })
        .expect(200);
      expect(
        (await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt,
      ).not.toBeNull();
      expect(await tick()).toBe(0);
    });

    it('never mixes tenants: every chat only hears about tasks of its own workspace', async () => {
      const a = await seedWorkspace(ctx.prisma, 'alpha');
      const b = await seedWorkspace(ctx.prisma, 'beta');
      const chatA = await linkChat(a.user.id, 'chat-a');
      const chatB = await linkChat(b.user.id, 'chat-b');
      await addTask(a.workspace.id, 'Alpha secret', { assigneeId: a.user.id });
      await addTask(b.workspace.id, 'Beta secret', { assigneeId: b.user.id });
      // assigned to someone who is not a member of the task's workspace: nobody is told
      await addTask(b.workspace.id, 'Beta leak attempt', { assigneeId: a.user.id });

      await tick();
      const heard = (chatId: string) =>
        telegram.sent.filter((m) => m.chatId === chatId).map((m) => m.text);
      expect(heard(chatA)).toEqual([expect.stringContaining('Alpha secret')]);
      expect(heard(chatA)[0]).toContain(`(${a.workspace.name})`);
      expect(heard(chatB)).toEqual([expect.stringContaining('Beta secret')]);
      expect(heard(chatB)[0]).toContain(`(${b.workspace.name})`);
      expect(telegram.sent.some((m) => m.text.includes('leak'))).toBe(false);
    });

    it('does not queue the same reminder again while it may still be in flight', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      await addTask(workspace.id, 'Once', { assigneeId: user.id });
      expect(await reminders.scheduleDue()).toBe(1);
      expect(await reminders.scheduleDue()).toBe(0);
      await queue.flush();
      expect(telegram.sent).toHaveLength(1);
    });

    it('is idempotent: a duplicate message does not send a second Telegram message', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      const task = await addTask(workspace.id, 'Duplicated', { assigneeId: user.id });
      const job = { taskId: task.id, userId: user.id, dueAt: task.dueDate!.getTime() };

      await queue.publish(REMINDERS_QUEUE, job);
      await queue.publish(REMINDERS_QUEUE, job);
      await queue.publish(REMINDERS_QUEUE, job);
      await queue.flush();
      expect(telegram.sent).toHaveLength(1);
    });

    it('ignores stale messages: task done, deleted or moved since it was queued', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      const done = await addTask(workspace.id, 'Finished meanwhile', { assigneeId: user.id });
      const moved = await addTask(workspace.id, 'Moved meanwhile', { assigneeId: user.id });
      const gone = await addTask(workspace.id, 'Deleted meanwhile', { assigneeId: user.id });
      const jobs = [done, moved, gone].map((task) => ({
        taskId: task.id,
        userId: user.id,
        dueAt: task.dueDate!.getTime(),
      }));
      await ctx.prisma.task.update({ where: { id: done.id }, data: { status: 'DONE' } });
      await ctx.prisma.task.update({ where: { id: moved.id }, data: { dueDate: soon(25) } });
      await ctx.prisma.task.delete({ where: { id: gone.id } });
      for (const job of jobs) await queue.publish(REMINDERS_QUEUE, job);
      await queue.flush();
      expect(telegram.sent).toEqual([]);
      expect(queue.deadLetters(REMINDERS_QUEUE)).toEqual([]);
    });

    it('retries a failed send with backoff and marks the task only after it went out', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      const task = await addTask(workspace.id, 'Flaky telegram', { assigneeId: user.id });
      telegram.failures = 2;

      await tick();
      expect(telegram.sent).toEqual([]);
      expect(
        (await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt,
      ).toBeNull();
      expect((await queue.status()).queues.find((q) => q.name === REMINDERS_QUEUE)?.retrying).toBe(
        1,
      );

      await queue.drain();
      expect(telegram.sent).toHaveLength(1);
      expect(
        (await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt,
      ).not.toBeNull();
      expect(queue.deadLetters(REMINDERS_QUEUE)).toEqual([]);
    });

    it('dead-letters a reminder that never goes through, and leaves the task unmarked', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      const task = await addTask(workspace.id, 'Hopeless', { assigneeId: user.id });
      telegram.failures = 100;

      await tick();
      await queue.drain();
      const dead = queue.deadLetters(REMINDERS_QUEUE);
      expect(dead).toHaveLength(1);
      expect(dead[0]).toMatchObject({ payload: { taskId: task.id }, error: 'Telegram is down' });
      expect(
        (await ctx.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).reminderSentAt,
      ).toBeNull();
    });
  });

  describe('google sync jobs', () => {
    const at = (days: number, hour = 10) => new Date(Date.now() + days * DAY + hour * 3600_000);
    const event = (id: string, title: string): GoogleEvent => ({
      id: `primary/${id}`,
      calendarId: 'primary',
      calendarName: 'Personal',
      title,
      startsAt: at(2),
      endsAt: at(2, 11),
      allDay: false,
      editable: true,
      recurring: false,
    });

    /** A signed-in person who has connected Google (the token is stored directly, as the callback would). */
    async function person(email: string, refreshToken = `token-${email}`) {
      await signIn(ctx, { email });
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
      const { workspaceId } = await ctx.prisma.membership.findFirstOrThrow({
        where: { userId: user.id },
      });
      await ctx.prisma.googleConnection.create({
        data: {
          userId: user.id,
          refreshTokenEnc: encryptToken(refreshToken),
          scope: `${CALENDAR_SCOPE} ${TASKS_SCOPE}`,
        },
      });
      return { user, workspaceId, refreshToken, token: await bearer(app, user) };
    }
    const syncAsync = (workspaceId: string, token?: string) => {
      const call = http().post(`/api/workspaces/${workspaceId}/google-calendar/sync-async`);
      return token ? call.set('Authorization', token) : call;
    };
    const titles = async (workspaceId: string) =>
      (await ctx.prisma.calendarEvent.findMany({ where: { workspaceId } })).map((e) => e.title);

    it('answers 202 at once and imports in the background', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      // hold Google back: the answer must not wait for it
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const listEvents = ctx.googleCalendar.listEvents.bind(ctx.googleCalendar);
      ctx.googleCalendar.listEvents = async (params) => {
        await gate;
        return listEvents(params);
      };
      try {
        const res = await syncAsync(who.workspaceId, who.token).expect(202);
        expect(res.body).toEqual({ queued: true });
        expect(await titles(who.workspaceId)).toEqual([]);

        release();
        await queue.flush();
        expect(await titles(who.workspaceId)).toEqual(['Lecture']);
        const connection = await ctx.prisma.googleConnection.findUniqueOrThrow({
          where: { userId: who.user.id },
        });
        expect(connection.lastSyncAt).not.toBeNull();
      } finally {
        release();
        ctx.googleCalendar.listEvents = listEvents;
      }
    });

    it('keeps the synchronous endpoint working next to it', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      await http()
        .post(`/api/workspaces/${who.workspaceId}/google-calendar/sync`)
        .set('Authorization', who.token)
        .expect(200);
      expect(await titles(who.workspaceId)).toEqual(['Lecture']);
    });

    it('needs a signed-in member of the workspace and a connected Google account', async () => {
      const who = await person('a@example.com');
      const stranger = await person('b@example.com');
      const publish = vi.spyOn(queue, 'publish');
      await syncAsync(who.workspaceId).expect(401);
      // other people's workspaces do not exist for you
      await syncAsync(who.workspaceId, stranger.token).expect(404);

      await ctx.prisma.googleConnection.delete({ where: { userId: who.user.id } });
      await syncAsync(who.workspaceId, who.token).expect(409);
      // nothing was queued for any of the refused calls
      expect(publish).not.toHaveBeenCalled();
      publish.mockRestore();
    });

    it('retries when Google fails for a moment', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      const listEvents = ctx.googleCalendar.listEvents.bind(ctx.googleCalendar);
      let calls = 0;
      ctx.googleCalendar.listEvents = async (params) => {
        calls += 1;
        if (calls === 1) throw new BadGatewayException('Google hiccup');
        return listEvents(params);
      };
      try {
        await syncAsync(who.workspaceId, who.token).expect(202);
        await queue.flush();
        expect(await titles(who.workspaceId)).toEqual([]);
        await queue.drain();
        expect(calls).toBe(2);
        expect(await titles(who.workspaceId)).toEqual(['Lecture']);
        expect(queue.deadLetters(GOOGLE_SYNC_QUEUE)).toEqual([]);
      } finally {
        ctx.googleCalendar.listEvents = listEvents;
      }
    });

    it('drops the job (no dead letter) when Google access was revoked', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.revokedByUser.add(who.refreshToken);
      await syncAsync(who.workspaceId, who.token).expect(202);
      await queue.drain();
      expect(queue.deadLetters(GOOGLE_SYNC_QUEUE)).toEqual([]);
      expect(await ctx.prisma.googleConnection.count()).toBe(0);
    });

    it('skips a job of someone who left the workspace meanwhile', async () => {
      const who = await person('a@example.com');
      ctx.googleCalendar.calendars.set(who.refreshToken, [event('1', 'Lecture')]);
      await ctx.prisma.membership.deleteMany({ where: { userId: who.user.id } });
      await queue.publish(GOOGLE_SYNC_QUEUE, { workspaceId: who.workspaceId, userId: who.user.id });
      await queue.flush();
      expect(await titles(who.workspaceId)).toEqual([]);
    });

    it('the periodic enqueue covers every connected person and every workspace of theirs', async () => {
      const a = await person('a@example.com');
      const b = await person('b@example.com');
      await person('c@example.com').then((c) =>
        ctx.prisma.googleConnection.delete({ where: { userId: c.user.id } }),
      );
      const second = await ctx.prisma.workspace.create({
        data: { name: 'Second', slug: 'second', memberships: { create: { userId: a.user.id } } },
      });
      ctx.googleCalendar.calendars.set(a.refreshToken, [event('1', 'A event')]);
      ctx.googleCalendar.calendars.set(b.refreshToken, [event('2', 'B event')]);

      expect(await app.get(GoogleSyncJobs).enqueueAll()).toBe(3);
      await queue.flush();
      expect(await titles(a.workspaceId)).toEqual(['A event']);
      expect(await titles(second.id)).toEqual(['A event']);
      expect(await titles(b.workspaceId)).toEqual(['B event']);
    });
  });

  describe('queue status', () => {
    it('is for platform admins only', async () => {
      const member = await seedWorkspace(ctx.prisma);
      await http().get('/api/queue-status').expect(401);
      await http()
        .get('/api/queue-status')
        .set('Authorization', await bearer(app, member.user))
        .expect(403);
    });

    it('shows the driver and the counters of every queue, dead letters included', async () => {
      const { user, workspace } = await seedWorkspace(ctx.prisma);
      await linkChat(user.id);
      await addTask(workspace.id, 'Hopeless', { assigneeId: user.id });
      telegram.failures = 100;
      await tick();
      await queue.drain();

      const admin = await ctx.prisma.user.create({
        data: { email: 'platform-admin@example.com', name: 'Admin' },
      });
      const res = await http()
        .get('/api/queue-status')
        .set('Authorization', await bearer(app, { id: admin.id, email: admin.email }))
        .expect(200);
      expect(res.body).toMatchObject({ driver: 'memory', connected: true });
      expect(res.body.queues).toEqual(
        expect.arrayContaining([
          { name: REMINDERS_QUEUE, messages: 0, consumers: 1, retrying: 0, dead: 1 },
          { name: GOOGLE_SYNC_QUEUE, messages: 0, consumers: 1, retrying: 0, dead: 0 },
        ]),
      );
    });
  });
});
