require('./safety.cjs').requireIsolated(process.env, 'jwt');
const jwt = require('/app/server/node_modules/jsonwebtoken');
const { allocateRoles, percentile, isBusinessSuccess, plannedActions, boundedWait, summarizeSamples } = require('./morning-plan.cjs');
const { allOrFail } = require('./parallel.cjs');
const n = Number(process.argv[2]), duration = Number(process.argv[3]), spread = Number(process.argv[4]);
const allocation = allocateRoles(n);
if (!Number.isFinite(duration) || duration < 5000 || duration > 1900000 || !Number.isFinite(spread) || spread < 0 || spread > duration) throw new Error('无效的持续时间或到达窗口');
const start = performance.now(), wallStart = new Date().toISOString(), base = 'http://app:3000/api';
const measures = {}, buckets = {}, journeys = {}, expected = { punch: 0, overtime: 0, approval: 0 };
let inFlight = 0, maxInFlight = 0, total = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
const identity = i => `T${String(i).padStart(4, '0')}`;
const token = (i, admin = false) => jwt.sign(admin ? { typ: 'admin', role: 'super_admin' } : { typ: 'access', sv: 0 }, process.env.PERF_JWT_SECRET, { subject: admin ? String(i) : identity(i), expiresIn: '7d' });
function add(label, elapsed, ok, reason) {
  const row = measures[label] ||= { durations: [], failed: 0, errors: {} };
  row.durations.push(elapsed);
  const bucket = buckets[String(Math.floor((performance.now() - start) / 60000))] ||= { durations: [], failed: 0, labels: {} };
  const item = bucket.labels[label] ||= { durations: [], failed: 0 };
  bucket.durations.push(elapsed); item.durations.push(elapsed); total++;
  if (!ok) { row.failed++; row.errors[reason] = (row.errors[reason] || 0) + 1; bucket.failed++; item.failed++; }
}
async function request(label, path, auth, options = {}) {
  const begin = performance.now(); let success = false, reason = '', result;
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    const headers = { ...(auth ? { Authorization: `Bearer ${auth}` } : {}) };
    let body;
    if (options.upload) { body = new FormData(); body.append('file', new Blob([Buffer.alloc(2 * 1024 * 1024)], { type: 'image/png' }), 'synthetic.png'); }
    else if (options.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.body); }
    const response = await fetch(base + path, { method: options.method || 'GET', headers, body, signal: AbortSignal.timeout(15000) });
    if (options.pdf) { const bytes = Buffer.from(await response.arrayBuffer()); success = response.ok && bytes.subarray(0, 4).toString() === '%PDF'; reason = `pdf_http_${response.status}`; }
    else {
      const envelope = await response.json(); result = envelope.data;
      success = isBusinessSuccess(response.status, envelope, Boolean(options.requireOk)) && (!options.validate || options.validate(result));
      reason = `http_${response.status}_code_${envelope.code}_${String(result?.message || envelope.message || '').slice(0, 40)}`;
    }
  } catch (error) { reason = error.name || 'network_error'; }
  finally { inFlight--; add(label, performance.now() - begin, success, reason); }
  if (!success) throw new Error(label);
  return result;
}
async function workbench(auth) {
  await request('entry_pending', '/onboarding-form/pending', auth);
  await allOrFail(['/me','/company','/attendance/today','/todo-stats','/quick-actions'].map(path => request(`workbench:${path}`, path, auth)));
  await allOrFail(['/approvals?tab=pending','/notices','/approvals/pending-count'].map(path => request(`workbench:${path}`, path, auth)));
}
async function action(role, cycle, i, auth) {
  const begin = performance.now(); let ok = false;
  try {
    if (role === 'punch' && cycle === 0) {
      await allOrFail(['/attendance/today','/attendance/stats','/attendance/settings','/attendance/overtime'].map(path => request(`attendance:${path}`, path, auth)));
      expected.punch++;
      await request('punch_in','/attendance/punch',auth,{ method:'POST',body:{type:'in',latitude:23.1,longitude:113.3,accuracy:10},requireOk:true });
      if (i <= 20) { expected.overtime++; await request('overtime_in','/attendance/overtime/punch',auth,{method:'POST',body:{approvalId:`MOT${String(i).padStart(4,'0')}`,type:'in',latitude:23.1,longitude:113.3,accuracy:10},requireOk:true}); }
    } else if (role === 'approval' && cycle === 0) {
      expected.approval++;
      await request('approval_create','/approvals',auth,{method:'POST',body:{type:'purchase',title:'morning synthetic purchase',summary:'test',form:[{label:'采购物品',value:'test'},{label:'预估金额（元）',value:'10'},{label:'采购理由',value:'test'}]},validate:x=>typeof x?.id==='string'});
    } else if (role === 'admin') {
      await allOrFail([request('admin_dashboard','/admin/dashboard',auth),request('admin_attendance','/admin/attendance',auth)]);
    } else if (role === 'approval') {
      await allOrFail([request('approval_counts','/approvals/counts',auth),request('approval_mine','/approvals?tab=mine',auth)]);
      if(cycle === 4 && i % 2 === 0) await request('invoice_upload','/invoices/image',auth,{method:'POST',upload:true,validate:x=>!!x?.fileUrl});
    } else if (role === 'browse') {
      const list = await request('browse_payslips','/payslips',auth,{validate:x=>Array.isArray(x)&&x.length>0});
      if(cycle === 0) await request('browse_pdf',`/payslips/${list[0].id}/pdf`,auth,{pdf:true});
      await allOrFail([request('browse_notices','/notices',auth),request('browse_contacts','/employees/groups',auth)]);
      if(cycle === 4 && i % 2 === 0) { const docs = await request('u9_list','/business/receivables?page=1',auth,{validate:x=>Array.isArray(x)&&x.length>0}); await request('u9_pdf',`/business/receivables/${docs[0].id}/pdf`,auth,{pdf:true}); }
    } else if (role === 'workbench') { if (cycle > 0) await workbench(auth); }
    else await request('punch_status','/attendance/today',auth);
    ok = true;
  } catch { /* failures are recorded per request */ }
  if (!(role === 'workbench' && cycle === 0)) {
    const key = `${role}:${cycle===0?'initial':'repeat'}`; const row = journeys[key] ||= { durations: [], failed: 0 };
    row.durations.push(performance.now() - begin); if (!ok) row.failed++;
  }
}
async function actor(i, role, roleIndex) {
  const arrivalSlot = ((i - 1) * 37) % n;
  await sleep(n === 1 ? 0 : spread * arrivalSlot / (n - 1));
  const admin = role === 'admin'; let auth = token(admin ? roleIndex + 2 : i, admin);
  if (!admin && i % 5 === 0) {
    try { const login = await request('password_login','/auth/password-login',null,{method:'POST',body:{loginName:`test${i}`,password:'synthetic-password'},validate:x=>typeof x?.accessToken==='string'});auth=login.accessToken; }
    catch { return; }
  }
  if (!admin) {
    const entryStart = performance.now(); let entryOk = true;
    try { await workbench(auth); } catch { entryOk = false; }
    const entry = journeys['entry:workbench'] ||= { durations: [], failed: 0 };
    entry.durations.push(performance.now() - entryStart); if (!entryOk) entry.failed++;
  }
  await action(role, 0, i, auth);
  let cycle = 1;
  while (performance.now() - start < duration) {
    await sleep(boundedWait(15000, duration, performance.now() - start));
    if (performance.now() - start >= duration) break;
    if (!admin) {
      try { await request('periodic_pending','/onboarding-form/pending',auth); await request('periodic_payslips','/payslips',auth); } catch { /* next cycle */ }
    }
    if (cycle % 4 === 0 && plannedActions(role, cycle).length) await action(role, cycle, i, auth);
    cycle++;
  }
}
async function main() {
  const workers = []; let number = 0;
  for (const [role, count] of Object.entries(allocation)) for (let i=0;i<count;i++) workers.push(actor(++number,role,i));
  await Promise.all(workers);
  const elapsed = Math.round(performance.now() - start), metrics = {}, flows = {}, minutes = {};
  for (const [name, v] of Object.entries(measures)) metrics[name] = { count:v.durations.length, failed:v.failed, p50:percentile(v.durations,.5), p95:percentile(v.durations,.95), p99:percentile(v.durations,.99), max:percentile(v.durations,1), errors:v.errors };
  for (const [name, v] of Object.entries(journeys)) flows[name] = { count:v.durations.length, failed:v.failed, p50:percentile(v.durations,.5), p95:percentile(v.durations,.95), p99:percentile(v.durations,.99) };
  for (const [minute,v] of Object.entries(buckets)) minutes[minute] = { ...summarizeSamples(v.durations,v.failed), labels:Object.fromEntries(Object.entries(v.labels).map(([name,item])=>[name,summarizeSamples(item.durations,item.failed)])) };
  console.log(JSON.stringify({ startUtc:wallStart, endUtc:new Date().toISOString(), users:n, allocation, durationMs:duration, arrivalSpreadMs:spread, elapsedMs:elapsed, totalRequests:total, observedRequestsPerSecond:Math.round(total/elapsed*100000)/100, maxConcurrentRequests:maxInFlight, expected, minutes, metrics, flows }));
}
main().catch(error => { console.error(error); process.exitCode=1; });
