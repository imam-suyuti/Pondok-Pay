import {Redis} from 'ioredis';
let client:Redis|undefined;
/** Lazy connection avoids opening Redis in unit tests and migration commands. */
export function getRedisClient(){if(!client){const url=process.env.REDIS_URL;if(!url)throw new Error('REDIS_URL is required when Redis-backed features are enabled.');client=new Redis(url,{maxRetriesPerRequest:2,enableReadyCheck:true});}return client;}
