if (process.env.PERF_ISOLATED !== 'yes' || process.env.PERF_U9_MOCK !== 'yes') throw new Error('U9 替身只允许在隔离环境中运行');
const { sqlServerU9 } = require('/app/server/dist/domains/u9/sqlServerGateway');
const wait = () => new Promise(resolve => setTimeout(resolve, 10));
sqlServerU9.listDocuments = async (_kind, operatorId) => { await wait(); return [{ id: operatorId, docNo: `SYN-${operatorId}`, date: '2026-11-01', customer: 'test', amount: '100.00', currency: 'CNY' }]; };
sqlServerU9.getDocument = async (_kind, operatorId, id) => { await wait(); return id === operatorId ? { id, docNo: `SYN-${operatorId}`, date: '2026-11-01', customer: 'test', currency: 'CNY', currencyPrecision: 2, lines: Array.from({ length: 30 }, (_, i) => ({ shipNo: `SYN-${i}`, amount: '1.00' })) } : null; };
sqlServerU9.getSummary = async operatorId => { await wait(); return Array.from({ length: 30 }, (_, i) => ({ CustomerCode: `C${i}`, CustomerName: 'test', ARTerm: 'test', DisplayName: 'test', UnRecMoney: '1.00', MoneyPrecision: 2, CurrencyName: 'CNY', Saleser: `SYN-${operatorId}` })); };
