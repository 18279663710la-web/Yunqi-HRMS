require('./safety.cjs').requireIsolated(process.env, 'mysql');
const mysql=require('/app/server/node_modules/mysql2/promise');
async function main(){
 const db=await mysql.createConnection({host:'db',user:'root',password:process.env.PERF_MYSQL_PASSWORD,database:'yunqi_perf'});
 const [identity]=await db.query('SELECT DATABASE() AS name');if(identity[0].name!=='yunqi_perf')throw Error('wrong database');
 const approvals=[],timelines=[];
 for(let i=1;i<=1000;i++){
  const id=`SYN${String(i).padStart(5,'0')}`, employee=`T${String((i-1)%100+1).padStart(4,'0')}`, status=i%3===0?'pending':'approved';
  approvals.push([id,'leave','test','synthetic',status,0,employee,'test','test','员工','test','test','[]',new Date()]);
  timelines.push([id,1,'test','applicant','submit','done',null]);
  timelines.push([id,2,'test','approver','review',status==='pending'?'current':'done','T0001']);
 }
 await db.beginTransaction();
 try{
  await db.query("INSERT INTO approval_approvers (type,employee_id,updated_by,updated_at) VALUES ('leave','T0001',1,NOW()),('purchase','T0001',1,NOW()) ON DUPLICATE KEY UPDATE employee_id=VALUES(employee_id)");
  await db.query('INSERT INTO approvals (id,type,type_name,title,status,urgent,applicant_id,applicant_name,applicant_dept,applicant_position,node,summary,form_json,created_at) VALUES ?', [approvals]);
  await db.query('INSERT INTO approval_timeline (approval_id,step_no,name,role,action,state,approver_id) VALUES ?', [timelines]);
  await db.commit();console.log(JSON.stringify({approvals:approvals.length,timelineRows:timelines.length}));
 }catch(e){await db.rollback();throw e;}finally{await db.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
