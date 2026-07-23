import {prisma} from '../../db/client.js';import type {TenantStatusRepository} from './tenant-status.service.js';
/** Tenants are platform metadata; this lookup is intentionally outside tenant-row RLS. */
export class PrismaTenantStatusRepository implements TenantStatusRepository {async status(tenantId:string){const tenant=await prisma.tenant.findUnique({where:{id:tenantId},select:{status:true}});return tenant?.status;}}
