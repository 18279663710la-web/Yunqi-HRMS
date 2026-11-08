require('./safety.cjs').requireIsolated(process.env, 'jwt');
const jwt = require('/app/server/node_modules/jsonwebtoken');
const { allOrFail } = require('./parallel.cjs');
const assert = require('node:assert/strict');
const base = 'http://app:3000/api';
const stats = {};
function percentile(values, p) { const a=[...values].sort((x,y)=>x-y); return a.length ? Math.round(a[Math.ceil(a.length*p)-1]*10)/10 : null; }
function goodJson(status, body) { return status >= 200 && status < 300 && body && body.code === 0; }
if(process.argv[2] === '--selftest') {
  assert.equal(percentile([1,2,3,4,5],.95),5);
  assert.equal(goodJson(200,{code:0,data:{ok:false}}),true);
  assert.equal(goodJson(200,{code:1}),false);
  assert.equal(goodJson(500,{code:0}),false);
  assert.equal(({data:{ok:false}}).data.ok === true,false);
  console.log('selftest passed'); process.exit(0);
}
const mode=process.argv[2], users=Number(process.argv[3]), spread=Number(process.argv[4]||0);
if(!['punch-in','punch-out','workbench','login','login-workbench','payslip','sustain','approval-read','approval-submit','contacts','notice','records','mixed','mixed-extended'].includes(mode) || !Number.isInteger(users) || users<1 || users>100 || spread<0 || spread>300000 || (mode.startsWith('mixed') && users!==100)) throw Error('invalid test parameters');
if(mode==='mixed-extended' && process.env.PERF_U9_MOCK!=='yes') throw Error('混合 U9 场景必须使用隔离网关替身');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function add(label,ms,ok,reason) {const s=stats[label] ||= {times:[],failed:0,reasons:{}};s.times.push(ms);if(!ok){s.failed++;s.reasons[reason]=(s.reasons[reason]||0)+1;}}
async function request(label,path,token,method='GET',body,validate) {
  const start=performance.now(); let ok=false, reason='unknown', data;
  try {
    const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    if(path.split('?')[0].endsWith('/pdf')) { const bytes=Buffer.from(await response.arrayBuffer()); ok=response.ok && bytes.subarray(0,4).toString()==='%PDF'; reason=ok?'':`pdf-http-${response.status}`; data=bytes; }
    else {const json=await response.json(); data=json.data; ok=goodJson(response.status,json) && (!validate || validate(data)); reason=ok?'':`http-${response.status}-code-${json.code}-${String(json.message||data?.message||'validation').slice(0,80)}`;}
  } catch(e){reason=e.name||'error';}
  add(label,performance.now()-start,ok,reason);
  if(!ok) throw Error(`${label}: ${reason}`);
  return data;
}
async function upload(token) {
  const form=new FormData();form.append('file',new Blob([Buffer.alloc(2*1024*1024)],{type:'image/png'}),'synthetic.png');
  const start=performance.now();let ok=false,reason='unknown';
  try {const response=await fetch(base+'/invoices/image',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form,signal:AbortSignal.timeout(15000)});const body=await response.json();ok=goodJson(response.status,body)&&!!body.data?.fileUrl;reason=ok?'':`upload-http-${response.status}-code-${body.code}`;}
  catch(error){reason=error.name||'error';}
  add('/invoices/image',performance.now()-start,ok,reason);if(!ok)throw Error(reason);
}
function token(i) {return jwt.sign({typ:'access',sv:0},process.env.PERF_JWT_SECRET,{subject:`T${String(i).padStart(4,'0')}`,expiresIn:'7d'});}
async function worker(i) {
  await sleep(users===1?0:spread*(i-1)/(users-1));
  const begin=performance.now(); let t=token(i), ok=false;
  const actual=mode==='mixed'?(i<=60?'punch-in':i<=80?'workbench':i<=90?'contacts':i<=95?'approval-submit':'payslip'):mode==='mixed-extended'?(i<=60?'punch-in':i<=70?'workbench':i<=75?'contacts':i<=80?'approval-submit':i<=85?'u9':i<=95?'upload':'payslip'):mode;
  try {
    if(actual==='login' || actual==='login-workbench') {
      const session=await request('password-login','/auth/password-login',null,'POST',{loginName:`test${i}`,password:'synthetic-password'},x=>typeof x?.accessToken==='string');
      t=session.accessToken;
    }
    if(actual==='login') {
      // Login has already been measured above.
    } else if(actual==='punch-in'||actual==='punch-out') {
      await allOrFail(['/attendance/today','/attendance/stats','/attendance/settings','/attendance/overtime'].map(p=>request(p,p,t)));
      await request(actual,'/attendance/punch',t,'POST',{type:actual==='punch-in'?'in':'out',latitude:23.1,longitude:113.3,accuracy:10},x=>x?.ok===true);
    } else if(actual==='workbench'||actual==='login-workbench') {
      await request('/onboarding-form/pending','/onboarding-form/pending',t);
      await allOrFail(['/me','/company','/attendance/today','/todo-stats','/quick-actions','/payslips'].map(p=>request(p,p,t)));
      await allOrFail(['/approvals?tab=pending','/notices','/approvals/pending-count'].map(p=>request(p,p,t)));
    } else if(actual==='payslip') {
      const list=await request('/payslips','/payslips',t,'GET',undefined,x=>Array.isArray(x)&&x.length===1);
      const slip=list[0];
      await request('/payslips/pdf',`/payslips/${slip.id}/pdf`,t);
      await request('/payslips/read',`/payslips/${slip.id}/read`,t,'POST',{revision:slip.revision});
    } else if(actual==='approval-read') {
      const [,list]=await allOrFail([request('/approvals/counts','/approvals/counts',t),request('/approvals?tab=mine','/approvals?tab=mine',t,'GET',undefined,x=>Array.isArray(x)&&x.length>0)]);
      await request('/approvals/detail',`/approvals/${list[0].id}`,t);
    } else if(actual==='approval-submit') {
      await request('/approvals/create','/approvals',t,'POST',{type:'purchase',title:'synthetic purchase',summary:'synthetic',form:[{label:'采购物品',value:'test item'},{label:'预估金额（元）',value:'10'},{label:'采购理由',value:'test'}]},x=>typeof x?.id==='string');
    } else if(actual==='contacts') {
      await request('/job-titles','/job-titles',t);await request('/employees/groups','/employees/groups',t);
    } else if(actual==='notice') {
      await request('/notices/categories','/notices/categories',t);const [list]=await allOrFail([request('/notices','/notices',t),request('/notices/unread-count','/notices/unread-count',t)]);if(Array.isArray(list)&&list.length)await request('/notices/detail',`/notices/${list[0].id}`,t);
    } else if(actual==='records') {
      await allOrFail([request('/attendance/records?days=31','/attendance/records?days=31',t),request('/attendance/stats','/attendance/stats',t)]);
    } else if(actual==='upload') {
      await upload(t);
    } else if(actual==='u9') {
      const list=await request('/business/receivables','/business/receivables?page=1',t,'GET',undefined,x=>Array.isArray(x)&&x.length>0);
      await request('/business/document/pdf',`/business/receivables/${list[0].id}/pdf`,t);
      await request('/business/summary/pdf','/business/summary/pdf?from=2026-01&to=2026-11',t);
    } else if(actual==='sustain') {
      const rounds=Number(process.argv[5]||8);
      for(let k=0;k<rounds;k++){const s=performance.now();await request('/onboarding-form/pending','/onboarding-form/pending',t);await request('/payslips','/payslips',t);if(k<rounds-1)await sleep(Math.max(0,15000-(performance.now()-s)));}
    }
    ok=true;
  } catch(e) { add('journey-error',0,false,e.message.slice(0,120)); }
  add('journey',performance.now()-begin,ok,ok?'':'request failed');
  if(mode.startsWith('mixed')) add('journey:'+actual,performance.now()-begin,ok,ok?'':'request failed');
}
async function main(){
  const start=performance.now(); await Promise.all(Array.from({length:users},(_,i)=>worker(i+1)));
  const output={mode,users,spreadMs:spread,elapsedMs:Math.round(performance.now()-start),metrics:{}};
  for(const [label,s] of Object.entries(stats)) output.metrics[label]={count:s.times.length,failed:s.failed,p50:percentile(s.times,.5),p95:percentile(s.times,.95),p99:percentile(s.times,.99),max:Math.round(Math.max(...s.times)*10)/10,reasons:s.reasons};
  console.log(JSON.stringify(output));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
