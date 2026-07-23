import { z } from 'zod';
const schema=z.object({DATABASE_URL:z.string().url(),JWT_ACCESS_SECRET:z.string().min(32),JWT_REFRESH_SECRET:z.string().min(32),JWT_ACCESS_EXPIRY:z.string().default('15m'),JWT_REFRESH_EXPIRY:z.string().default('7d'),NODE_ENV:z.enum(['development','test','production']).default('development')});
export const env=schema.parse(process.env);
