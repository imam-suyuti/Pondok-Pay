import {describe,expect,it} from 'vitest';import {TenantStatusService,type TenantStatusRepository} from '../src/modules/tenants/tenant-status.service.js';
class Repo implements TenantStatusRepository {value:'ACTIVE'|'SUSPENDED'='ACTIVE';async status(){return this.value}}
describe('tenant status enforcement',()=>{it('rejects suspended tenant',async()=>{const repo=new Repo();repo.value='SUSPENDED';await expect(new TenantStatusService(repo).assertActive('tenant')).rejects.toMatchObject({code:'TENANT_SUSPENDED'});});});
