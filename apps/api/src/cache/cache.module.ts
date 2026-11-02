import { Global, Logger, Module } from '@nestjs/common';
import { env } from '../env.js';
import { CACHE_DRIVER, type CacheDriver } from './cache.driver.js';
import { CacheService } from './cache.service.js';
import { MemoryCache } from './memory-cache.js';
import { RedisCache } from './redis-cache.js';

@Global()
@Module({
  providers: [
    {
      provide: CACHE_DRIVER,
      useFactory: (): CacheDriver => {
        if (!env.redisUrl) return new MemoryCache();
        new Logger('CacheModule').log('Caching in Redis');
        return RedisCache.connect(env.redisUrl);
      },
    },
    CacheService,
  ],
  exports: [CacheService, CACHE_DRIVER],
})
export class CacheModule {}
