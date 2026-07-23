import { PrismaClient, Prisma } from '@prisma/client';
export const prisma = new PrismaClient();
/** All tenant queries must execute in this transaction helper; it sets RLS context before querying. */
export async function withTenant<T>(tenantId:string, fn:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T> { return prisma.$transaction(async (tx:Prisma.TransactionClient) => { await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`; return fn(tx); }); }
