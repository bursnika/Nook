import { Global, Module } from '@nestjs/common';
import { GraphqlModule } from '../graphql/graphql.module.js';
import { MetricsController } from './metrics.controller.js';
import { PresenceService } from './presence.service.js';
import { RealtimeBus } from './realtime.bus.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { TransportMetrics } from './transport-metrics.js';

/** Live updates: block operations of a page over WebSocket, long poll or polling, and GraphQL subscriptions. */
@Global()
@Module({
  imports: [GraphqlModule],
  controllers: [SyncController, MetricsController],
  providers: [RealtimeBus, TransportMetrics, PresenceService, SyncService, RealtimeGateway],
  exports: [RealtimeBus, TransportMetrics],
})
export class RealtimeModule {}
