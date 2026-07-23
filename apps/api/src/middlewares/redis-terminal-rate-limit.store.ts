import type {Redis as RedisClient} from 'ioredis';import type {TerminalRateLimitStore} from './terminal-rate-limit.js';
/** Redis-backed counter shared by every API instance. */
export class RedisTerminalRateLimitStore implements TerminalRateLimitStore {constructor(private readonly redis:RedisClient){}async increment(key:string,windowSeconds:number){const count=await this.redis.incr(key);if(count===1)await this.redis.expire(key,windowSeconds);return count;}}
