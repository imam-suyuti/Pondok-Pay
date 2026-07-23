export type DashboardRole = 'SUPER_ADMIN'|'ADMIN_PESANTREN'|'OPERATOR_MERCHANT'|'WALI_SANTRI';
export interface NavigationItem { label:string; roles:DashboardRole[]; }
/** UX-only menu filtering. The API remains the authorization boundary. */
export const adminNavigation:NavigationItem[]=[
 {label:'Tenant & Tagihan Platform',roles:['SUPER_ADMIN']},
 {label:'Konfigurasi Platform',roles:['SUPER_ADMIN']},
 {label:'Data Santri',roles:['ADMIN_PESANTREN']},
 {label:'Merchant',roles:['ADMIN_PESANTREN']},
 {label:'Kartu RFID',roles:['ADMIN_PESANTREN']},
 {label:'Terminal',roles:['ADMIN_PESANTREN']},
 {label:'Laporan',roles:['ADMIN_PESANTREN']},
];
export const navigationForRole=(role:DashboardRole)=>adminNavigation.filter(item=>item.roles.includes(role));
