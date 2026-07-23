import {AppError} from '../../shared/errors.js';
export interface TenantStatusRepository {status(tenantId:string):Promise<'ACTIVE'|'SUSPENDED'|undefined>;}
export class TenantStatusService {constructor(private readonly repository:TenantStatusRepository){}async assertActive(tenantId:string){if(await this.repository.status(tenantId)!=='ACTIVE')throw new AppError('TENANT_SUSPENDED','Sistem sedang tidak tersedia.',403);}}
