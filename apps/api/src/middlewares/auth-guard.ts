import type { FastifyRequest } from 'fastify'; import jwt from 'jsonwebtoken'; import { env } from '../config/env.js'; import { AppError } from '../shared/errors.js';
import { tenantGuard } from './tenant-guard.js'; import type { JwtClaims } from '@pondokpay/shared-types';
declare module 'fastify' { interface FastifyRequest { auth?:JwtClaims } }
export async function authGuard(req:FastifyRequest){const raw=req.headers.authorization?.replace(/^Bearer\s+/,'');if(!raw) throw new AppError('UNAUTHORIZED','Autentikasi diperlukan.',401);try{req.auth=jwt.verify(raw,env.JWT_ACCESS_SECRET) as JwtClaims;}catch{throw new AppError('UNAUTHORIZED','Token tidak valid atau telah berakhir.',401);}}
export const requireRoles=(...roles:JwtClaims['role'][])=>async(req:FastifyRequest)=>{await authGuard(req);if(!req.auth||!roles.includes(req.auth.role))throw new AppError('FORBIDDEN','Anda tidak memiliki akses.',403);const { tenantGuard } = await import('./tenant-guard.js'); await tenantGuard(req);};
