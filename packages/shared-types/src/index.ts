import { z } from 'zod';
export const StaffRole = z.enum(['SUPER_ADMIN', 'ADMIN_PESANTREN', 'OPERATOR_MERCHANT']);
export const UserRole = z.union([StaffRole, z.literal('WALI_SANTRI')]);
export type UserRole = z.infer<typeof UserRole>;
export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInput>;
export interface JwtClaims { sub: string; role: UserRole; tenant_id: string | null; merchant_scope: string[]; }
export const apiSuccess = <T>(data: T, requestId: string) => ({ success: true as const, data, meta: { requestId, timestamp: new Date().toISOString() } });
export const apiError = (code: string, message: string, requestId: string, details: Record<string, unknown> = {}) => ({ success: false as const, error: { code, message, details }, meta: { requestId, timestamp: new Date().toISOString() } });
