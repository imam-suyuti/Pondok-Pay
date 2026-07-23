import {getRedisClient} from '../cache/redis.js';import {RedisTerminalRateLimitStore} from './redis-terminal-rate-limit.store.js';import {TerminalRateLimiter} from './terminal-rate-limit.js';
export function createTerminalRateLimiter(){return new TerminalRateLimiter(new RedisTerminalRateLimitStore(getRedisClient()),Number(process.env.API_RATE_LIMIT_PER_MINUTE??60));}
