require('./safety.cjs').requireIsolated(process.env, 'jwt');
const assert=require('node:assert/strict');
const jwt=require('/app/server/node_modules/jsonwebtoken');
const t=jwt.sign({typ:'access',sv:0},process.env.PERF_JWT_SECRET,{subject:'T0001',expiresIn:'1h'});
async function main(){
  const headers={Authorization:`Bearer ${t}`,'Content-Type':'application/json'};
  const list=await (await fetch('http://app:3000/api/payslips',{headers})).json();
  assert.equal(list.code,0);assert.equal(list.data.length,1);
  const id=list.data[0].id;
  const wrong=id===1?2:1;
  const download=await fetch(`http://app:3000/api/payslips/${wrong}/pdf`,{headers});
  const mark=await fetch(`http://app:3000/api/payslips/${wrong}/read`,{method:'POST',headers,body:JSON.stringify({revision:1})});
  assert.equal(download.status,404);assert.equal(mark.status,404);
  console.log(JSON.stringify({ownListCount:list.data.length,otherDownload:download.status,otherMarkRead:mark.status}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
