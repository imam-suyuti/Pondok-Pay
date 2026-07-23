import type {FastifyInstance} from 'fastify';import {z} from 'zod';import {requireRoles} from '../../middlewares/auth-guard.js';
export interface ReconciliationPort {report(input:{tenantId:string;staffId:string;from:Date;to:Date}):Promise<unknown>;}
const query=z.object({from:z.string().datetime(),to:z.string().datetime()});
export async function registerReportController(app:FastifyInstance,deps:{reconciliation:ReconciliationPort}){app.get('/v1/reports/reconciliation',{preHandler:requireRoles('ADMIN_PESANTREN')},async req=>{const {from,to}=query.parse(req.query),report=await deps.reconciliation.report({tenantId:req.auth!.tenant_id!,staffId:req.auth!.sub,from:new Date(from),to:new Date(to)});return {success:true,data:report,meta:{requestId:req.id,timestamp:new Date().toISOString()}};});}
