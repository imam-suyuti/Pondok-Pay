import type { JwtClaims } from '@pondokpay/shared-types';
export function staffClaims(user:{id:string;role:JwtClaims['role'];tenantId:string|null;merchantScope:string[]}):JwtClaims { return {sub:user.id,role:user.role,tenant_id:user.tenantId,merchant_scope:user.merchantScope}; }
export function waliClaims(waliId:string):JwtClaims { return {sub:waliId,role:'WALI_SANTRI',tenant_id:null,merchant_scope:[]}; }
