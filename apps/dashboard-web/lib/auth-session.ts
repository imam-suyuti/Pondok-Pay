export interface SessionUser {id:string;role:string;tenant_id:string|null;merchant_scope:string[];}
let accessToken:string|null=null;let user:SessionUser|null=null;
/** Access tokens deliberately live only in JS memory; refresh token remains httpOnly server cookie. */
export function setAuthSession(token:string,nextUser:SessionUser){accessToken=token;user=nextUser;}
export function getAccessToken(){return accessToken;}
export function getSessionUser(){return user;}
export async function refreshAuthSession(apiBase:string){const response=await fetch(`${apiBase}/v1/auth/refresh`,{method:'POST',credentials:'include'});if(!response.ok)return null;const payload=await response.json();setAuthSession(payload.data.access_token,payload.data.user);return payload.data;}
export async function logoutAuthSession(apiBase:string){await fetch(`${apiBase}/v1/auth/logout`,{method:'POST',credentials:'include'});accessToken=null;user=null;}
