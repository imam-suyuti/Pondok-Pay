import {AppError} from '../shared/errors.js';
export interface TerminalRateLimitStore {increment(key:string,windowSeconds:number):Promise<number>;}
/** Store must be backed by Redis in production to work across API instances. */
export class TerminalRateLimiter {constructor(private readonly store:TerminalRateLimitStore,private readonly limit=60){}async enforce(deviceId:string,ip:string){const minute=Math.floor(Date.now()/60_000),count=await this.store.increment(`terminal-rate:${deviceId}:${ip}:${minute}`,60);if(count>this.limit)throw new AppError('RATE_LIMITED','Terlalu banyak permintaan dari terminal.',429,{limit:this.limit});}}
