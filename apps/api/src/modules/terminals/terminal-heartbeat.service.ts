export interface TerminalHeartbeatRepository {recordHeartbeat(tenantId:string,terminalId:string,at:Date):Promise<void>;}
/** Device authentication is performed by the controller before this service is called. */
export class TerminalHeartbeatService {constructor(private readonly repository:TerminalHeartbeatRepository){}async heartbeat(tenantId:string,terminalId:string,now=new Date()){await this.repository.recordHeartbeat(tenantId,terminalId,now);return {status:'ACTIVE' as const,lastHeartbeatAt:now};}}
