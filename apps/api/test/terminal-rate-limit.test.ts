import {describe,expect,it} from 'vitest';import {TerminalRateLimiter,type TerminalRateLimitStore} from '../src/middlewares/terminal-rate-limit.js';
class Store implements TerminalRateLimitStore {count=0;async increment(){return ++this.count}}
describe('terminal rate limiter',()=>{it('allows 60 requests then rejects the 61st for a device',async()=>{const limiter=new TerminalRateLimiter(new Store());for(let i=0;i<60;i++)await limiter.enforce('device','127.0.0.1');await expect(limiter.enforce('device','127.0.0.1')).rejects.toMatchObject({code:'RATE_LIMITED',statusCode:429});});});
