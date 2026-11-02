import { Injectable } from '@nestjs/common';

export type TransportName = 'websocket' | 'longpoll' | 'polling' | 'graphql-ws';

export interface Counters {
  requests: number;
  messages: number;
  bytesIn: number;
  bytesOut: number;
}

const empty = (): Counters => ({ requests: 0, messages: 0, bytesIn: 0, bytesOut: 0 });

@Injectable()
export class TransportMetrics {
  private counters: Record<TransportName, Counters> = this.fresh();
  private since = Date.now();
  private cpuStart = process.cpuUsage();

  add(name: TransportName, delta: Partial<Counters>) {
    const c = this.counters[name];
    for (const key of Object.keys(delta) as (keyof Counters)[]) c[key] += delta[key] ?? 0;
  }

  snapshot() {
    const cpu = process.cpuUsage(this.cpuStart);
    return {
      seconds: (Date.now() - this.since) / 1000,
      cpuMs: (cpu.user + cpu.system) / 1000,
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      transports: this.counters,
    };
  }

  reset() {
    this.counters = this.fresh();
    this.since = Date.now();
    this.cpuStart = process.cpuUsage();
  }

  private fresh(): Record<TransportName, Counters> {
    return { websocket: empty(), longpoll: empty(), polling: empty(), 'graphql-ws': empty() };
  }
}
