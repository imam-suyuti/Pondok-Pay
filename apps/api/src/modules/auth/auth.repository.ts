import { prisma } from '../../db/client.js';
export const authRepository={
 findStaffByEmail:(email:string)=>prisma.staffUser.findUnique({where:{email},include:{tenant:true}}),
 findWaliByEmail:(email:string)=>prisma.waliSantri.findUnique({where:{email}}),
 revokeToken:(hash:string)=>prisma.refreshToken.updateMany({where:{tokenHash:hash,revokedAt:null},data:{revokedAt:new Date()}}),
};
