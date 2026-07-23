/**
 * The sole public write gateway for ledger_entries. Domain repositories may only
 * be provided to this service; no other module may write a ledger entry directly.
 */
export type EntryType = 'DEBIT'|'KREDIT';
export interface LedgerCard { id:string; tenantId:string; santriId:string; status:'ACTIVE'|'FROZEN'|'REPLACED'|'REVOKED'|'INACTIVE'; pinHash:string; }
export interface LedgerAccount { id:string; tenantId:string; entityType:'SANTRI'|'MERCHANT'|'PESANTREN_POOL'|'PESANTREN_OPERATING_CASH'; entityId:string; }
export type TransactionType = 'SALE'|'TOPUP_TERMINAL'|'WITHDRAWAL_TERMINAL';
export interface LedgerTransaction { id:string; journalId:string; idempotencyKey:string; tenantId:string; santriId:string; amount:number; type:TransactionType; status:'SUCCESS'|'VOIDED'; merchantId:string|null; terminalId?:string; operatorId?:string; withdrawalReason?:string; createdAt:Date; }
export interface LedgerEntry { journalId:string; accountId:string; entryType:EntryType; amount:number; balanceSnapshot:number; description:string; }
export interface ChargeCommand { tenantId:string; cardId:string; encryptedPin:string; merchantId:string; amount:number; idempotencyKey:string; now?:Date; }
export interface ChargeResult { transactionId:string;journalId:string;newBalance:number;idempotent:boolean; }
export interface TerminalTopupCommand { tenantId:string; cardId:string; amount:number; merchantId:string|null; terminalType:'MERCHANT'|'ADMIN'; terminalId:string; operatorId?:string; idempotencyKey:string; now?:Date; }
export interface VoidTransactionCommand { tenantId:string; transactionId:string; staffId:string; reason:string; now?:Date; voidWindowMinutes:number; }
export interface SettlementPayoutCommand { tenantId:string; merchantId:string; staffId:string; amount:number; }
export interface TerminalWithdrawalCommand { tenantId:string; cardId:string; encryptedPin:string; amount:number; reason:string; merchantId:string; terminalId:string; operatorId?:string; idempotencyKey:string; now?:Date; }
export interface LedgerRepository {
 runSerializable<T>(tenantId:string,work:()=>Promise<T>):Promise<T>;
 findTransactionByIdempotency(key:string):Promise<LedgerTransaction|undefined>;
 findTransactionById(id:string):Promise<LedgerTransaction|undefined>;
 markTransactionVoided(id:string,staffId:string,reason:string):Promise<void>;
 lockCard(id:string,tenantId:string):Promise<LedgerCard|undefined>;
 verifyPin(encryptedPin:string,pinHash:string):Promise<boolean>;
 lockAccount(tenantId:string,entityType:'SANTRI'|'MERCHANT'|'PESANTREN_POOL'|'PESANTREN_OPERATING_CASH',entityId:string):Promise<LedgerAccount|undefined>;
 runningBalance(accountId:string):Promise<number>;
 successfulSalesToday(tenantId:string,santriId:string,now:Date):Promise<number>;
 dailyLimit(tenantId:string,santriId:string):Promise<number>;
 appendBalancedEntries(entries:[LedgerEntry,LedgerEntry]):Promise<void>;
 createTransaction(transaction:LedgerTransaction):Promise<void>;
 cashTopupLimit(tenantId:string):Promise<number>;
 cashWithdrawalLimit(tenantId:string):Promise<number>;
 appendAudit(input:{tenantId:string;action:'TRANSACTION_CHARGE'|'TRANSACTION_VOID';resourceId:string;metadata:Record<string,unknown>}):Promise<void>;
 uuid():string;
}
export class LedgerError extends Error { constructor(public readonly code:'CARD_NOT_ACTIVE'|'INVALID_PIN'|'INSUFFICIENT_BALANCE'|'DAILY_LIMIT_EXCEEDED'|'VALIDATION_ERROR'|'TOPUP_LIMIT_EXCEEDED'|'WITHDRAWAL_LIMIT_EXCEEDED'|'VOID_WINDOW_EXPIRED',message:string,public readonly details:Record<string,unknown>={}){super(message);} }
export class LedgerService {
 constructor(private readonly repository:LedgerRepository){}
 async processCharge(command:ChargeCommand):Promise<ChargeResult>{
  if(!Number.isSafeInteger(command.amount)||command.amount<=0)throw new LedgerError('VALIDATION_ERROR','Nominal transaksi harus berupa Rupiah bulat positif.');
  return this.repository.runSerializable(command.tenantId,async()=>{
   const existing=await this.repository.findTransactionByIdempotency(command.idempotencyKey);
   if(existing)return {transactionId:existing.id,journalId:existing.journalId,newBalance:await this.balanceAfter(existing),idempotent:true};
   const card=await this.repository.lockCard(command.cardId,command.tenantId);
   if(!card||card.status!=='ACTIVE')throw new LedgerError('CARD_NOT_ACTIVE','Kartu tidak aktif.');
   if(!await this.repository.verifyPin(command.encryptedPin,card.pinHash))throw new LedgerError('INVALID_PIN','PIN tidak valid.');
   const santri=await this.repository.lockAccount(command.tenantId,'SANTRI',card.santriId);
   const merchant=await this.repository.lockAccount(command.tenantId,'MERCHANT',command.merchantId);
   if(!santri||!merchant)throw new LedgerError('VALIDATION_ERROR','Akun transaksi tidak ditemukan.');
   const balance=await this.repository.runningBalance(santri.id);
   if(balance<command.amount)throw new LedgerError('INSUFFICIENT_BALANCE','Saldo santri tidak mencukupi.',{current_balance:balance,requested_amount:command.amount});
   const now=command.now??new Date(); const spent=await this.repository.successfulSalesToday(command.tenantId,card.santriId,now); const limit=await this.repository.dailyLimit(command.tenantId,card.santriId);
   if(spent+command.amount>limit)throw new LedgerError('DAILY_LIMIT_EXCEEDED','Limit jajan harian telah terlampaui.',{daily_limit:limit,spent_today:spent});
   const journalId=this.repository.uuid();const transactionId=this.repository.uuid();const merchantBalance=await this.repository.runningBalance(merchant.id);
   await this.repository.appendBalancedEntries([{journalId,accountId:santri.id,entryType:'DEBIT',amount:command.amount,balanceSnapshot:balance-command.amount,description:'Pembelian melalui terminal'},{journalId,accountId:merchant.id,entryType:'KREDIT',amount:command.amount,balanceSnapshot:merchantBalance+command.amount,description:'Penjualan melalui terminal'}]);
   await this.repository.createTransaction({id:transactionId,journalId,idempotencyKey:command.idempotencyKey,tenantId:command.tenantId,santriId:card.santriId,amount:command.amount,type:'SALE',status:'SUCCESS',merchantId:command.merchantId,createdAt:now});
   await this.repository.appendAudit({tenantId:command.tenantId,action:'TRANSACTION_CHARGE',resourceId:journalId,metadata:{transactionId,amount:command.amount}});
   return {transactionId,journalId,newBalance:balance-command.amount,idempotent:false};
  });
 }
 async processSettlementPayout(command:SettlementPayoutCommand):Promise<{journalId:string}>{
  this.assertPositiveAmount(command.amount);return this.repository.runSerializable(command.tenantId,async()=>{const merchant=await this.repository.lockAccount(command.tenantId,'MERCHANT',command.merchantId),cash=await this.repository.lockAccount(command.tenantId,'PESANTREN_OPERATING_CASH',command.tenantId);if(!merchant||!cash)throw new LedgerError('VALIDATION_ERROR','Akun settlement tidak ditemukan.');const merchantBalance=await this.repository.runningBalance(merchant.id);if(merchantBalance<command.amount)throw new LedgerError('VALIDATION_ERROR','Nominal pencairan melebihi saldo merchant.');const cashBalance=await this.repository.runningBalance(cash.id),journalId=this.repository.uuid();await this.repository.appendBalancedEntries([{journalId,accountId:merchant.id,entryType:'DEBIT',amount:command.amount,balanceSnapshot:merchantBalance-command.amount,description:'Pencairan settlement merchant'},{journalId,accountId:cash.id,entryType:'KREDIT',amount:command.amount,balanceSnapshot:cashBalance+command.amount,description:'Pencairan settlement merchant'}]);await this.repository.appendAudit({tenantId:command.tenantId,action:'TRANSACTION_VOID',resourceId:journalId,metadata:{type:'SETTLEMENT_PAYOUT',staffId:command.staffId,amount:command.amount}});return {journalId};});
 }
 async voidTransaction(command:VoidTransactionCommand):Promise<{journalId:string}>{
  if(!command.reason.trim())throw new LedgerError('VALIDATION_ERROR','Alasan void wajib diisi.');
  return this.repository.runSerializable(command.tenantId,async()=>{const original=await this.repository.findTransactionById(command.transactionId);if(!original||original.type!=='SALE'||original.status!=='SUCCESS')throw new LedgerError('VALIDATION_ERROR','Transaksi tidak dapat dibatalkan.');const now=command.now??new Date();if(now.getTime()-original.createdAt.getTime()>command.voidWindowMinutes*60_000)throw new LedgerError('VOID_WINDOW_EXPIRED','Batas waktu void transaksi telah berakhir.');const santri=await this.repository.lockAccount(original.tenantId,'SANTRI',original.santriId),merchant=await this.repository.lockAccount(original.tenantId,'MERCHANT',original.merchantId!);if(!santri||!merchant)throw new LedgerError('VALIDATION_ERROR','Akun transaksi tidak ditemukan.');const santriBalance=await this.repository.runningBalance(santri.id),merchantBalance=await this.repository.runningBalance(merchant.id),journalId=this.repository.uuid();await this.repository.appendBalancedEntries([{journalId,accountId:santri.id,entryType:'KREDIT',amount:original.amount,balanceSnapshot:santriBalance+original.amount,description:'Pembalikan transaksi'},{journalId,accountId:merchant.id,entryType:'DEBIT',amount:original.amount,balanceSnapshot:merchantBalance-original.amount,description:'Pembalikan transaksi'}]);await this.repository.markTransactionVoided(original.id,command.staffId,command.reason);await this.repository.appendAudit({tenantId:original.tenantId,action:'TRANSACTION_VOID',resourceId:journalId,metadata:{transactionId:original.id,reason:command.reason}});return {journalId};});
 }
 async processTerminalTopup(command:TerminalTopupCommand):Promise<ChargeResult>{
  this.assertPositiveAmount(command.amount); if(command.terminalType==='MERCHANT'&&!command.merchantId)throw new LedgerError('VALIDATION_ERROR','Terminal merchant wajib memiliki merchant.'); if(command.terminalType==='ADMIN'&&command.merchantId)throw new LedgerError('VALIDATION_ERROR','Terminal admin tidak boleh memiliki merchant.');
  return this.repository.runSerializable(command.tenantId,async()=>{const existing=await this.repository.findTransactionByIdempotency(command.idempotencyKey);if(existing)return {transactionId:existing.id,journalId:existing.journalId,newBalance:await this.balanceAfter(existing),idempotent:true};const card=await this.repository.lockCard(command.cardId,command.tenantId);if(!card||card.status!=='ACTIVE')throw new LedgerError('CARD_NOT_ACTIVE','Kartu tidak aktif.');if(command.amount>await this.repository.cashTopupLimit(command.tenantId))throw new LedgerError('TOPUP_LIMIT_EXCEEDED','Nominal top up melebihi limit.');const santri=await this.repository.lockAccount(command.tenantId,'SANTRI',card.santriId);const source=command.terminalType==='MERCHANT'?await this.repository.lockAccount(command.tenantId,'MERCHANT',command.merchantId!):await this.repository.lockAccount(command.tenantId,'PESANTREN_POOL',command.tenantId);if(!santri||!source)throw new LedgerError('VALIDATION_ERROR','Akun transaksi tidak ditemukan.');const balance=await this.repository.runningBalance(santri.id);const sourceBalance=await this.repository.runningBalance(source.id);const journalId=this.repository.uuid(),transactionId=this.repository.uuid(),now=command.now??new Date();await this.repository.appendBalancedEntries([{journalId,accountId:santri.id,entryType:'KREDIT',amount:command.amount,balanceSnapshot:balance+command.amount,description:'Top up tunai terminal'},{journalId,accountId:source.id,entryType:'DEBIT',amount:command.amount,balanceSnapshot:sourceBalance-command.amount,description:'Dana top up tunai terminal'}]);await this.repository.createTransaction({id:transactionId,journalId,idempotencyKey:command.idempotencyKey,tenantId:command.tenantId,santriId:card.santriId,amount:command.amount,type:'TOPUP_TERMINAL',status:'SUCCESS',merchantId:command.merchantId,terminalId:command.terminalId,operatorId:command.operatorId,createdAt:now});await this.repository.appendAudit({tenantId:command.tenantId,action:'TRANSACTION_CHARGE',resourceId:journalId,metadata:{transactionId,amount:command.amount,type:'TOPUP_TERMINAL'}});return {transactionId,journalId,newBalance:balance+command.amount,idempotent:false};});
 }
 async processTerminalWithdrawal(command:TerminalWithdrawalCommand):Promise<ChargeResult>{
  this.assertPositiveAmount(command.amount);return this.repository.runSerializable(command.tenantId,async()=>{const existing=await this.repository.findTransactionByIdempotency(command.idempotencyKey);if(existing)return {transactionId:existing.id,journalId:existing.journalId,newBalance:await this.balanceAfter(existing),idempotent:true};const card=await this.repository.lockCard(command.cardId,command.tenantId);if(!card||card.status!=='ACTIVE')throw new LedgerError('CARD_NOT_ACTIVE','Kartu tidak aktif.');if(!await this.repository.verifyPin(command.encryptedPin,card.pinHash))throw new LedgerError('INVALID_PIN','PIN tidak valid.');if(command.amount>await this.repository.cashWithdrawalLimit(command.tenantId))throw new LedgerError('WITHDRAWAL_LIMIT_EXCEEDED','Nominal penarikan melebihi limit.');const santri=await this.repository.lockAccount(command.tenantId,'SANTRI',card.santriId),merchant=await this.repository.lockAccount(command.tenantId,'MERCHANT',command.merchantId);if(!santri||!merchant)throw new LedgerError('VALIDATION_ERROR','Akun transaksi tidak ditemukan.');const balance=await this.repository.runningBalance(santri.id);if(balance<command.amount)throw new LedgerError('INSUFFICIENT_BALANCE','Saldo santri tidak mencukupi.',{current_balance:balance,requested_amount:command.amount});const merchantBalance=await this.repository.runningBalance(merchant.id),journalId=this.repository.uuid(),transactionId=this.repository.uuid(),now=command.now??new Date();await this.repository.appendBalancedEntries([{journalId,accountId:santri.id,entryType:'DEBIT',amount:command.amount,balanceSnapshot:balance-command.amount,description:'Penarikan tunai terminal'},{journalId,accountId:merchant.id,entryType:'KREDIT',amount:command.amount,balanceSnapshot:merchantBalance+command.amount,description:'Dana penarikan tunai terminal'}]);await this.repository.createTransaction({id:transactionId,journalId,idempotencyKey:command.idempotencyKey,tenantId:command.tenantId,santriId:card.santriId,amount:command.amount,type:'WITHDRAWAL_TERMINAL',status:'SUCCESS',merchantId:command.merchantId,terminalId:command.terminalId,operatorId:command.operatorId,withdrawalReason:command.reason,createdAt:now});await this.repository.appendAudit({tenantId:command.tenantId,action:'TRANSACTION_CHARGE',resourceId:journalId,metadata:{transactionId,amount:command.amount,type:'WITHDRAWAL_TERMINAL'}});return {transactionId,journalId,newBalance:balance-command.amount,idempotent:false};});
 }
 private assertPositiveAmount(amount:number){if(!Number.isSafeInteger(amount)||amount<=0)throw new LedgerError('VALIDATION_ERROR','Nominal transaksi harus berupa Rupiah bulat positif.');}
 private async balanceAfter(transaction:LedgerTransaction){const account=await this.repository.lockAccount(transaction.tenantId,'SANTRI',transaction.santriId);return account?this.repository.runningBalance(account.id):0;}
}
