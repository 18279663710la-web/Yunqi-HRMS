import assert from 'node:assert/strict';
import test from 'node:test';
test('被打回的入职表回填原字段和照片，但不自动沿用签名和声明同意', async () => {
 const g=globalThis as any; let page: any;
 g.Page=(p: any)=>{page=p;}; g.getCurrentPages=()=>[];
 g.wx={getStorageSync:()=> 'token', showToast:()=>{}, request:(o:any)=>o.success({statusCode:200,data:{code:0,data:{id:1, declaration:'声明', template:[{name:'姓名',type:'text',required:true},{name:'性别',type:'select',required:true,options:['男','女']},{name:'部门',type:'select',required:true,options:['研发','行政']},{name:'经历',type:'table',required:false,children:[{name:'学历',type:'select',required:true,options:['本科','硕士']},{name:'年份',type:'number',required:false}]}],previous:{values:{姓名:'张三',性别:'女',部门:'旧部门',经历:[{学历:'硕士',年份:2020}]},photo:'data:image/png;base64,abc'}}}})};
 await import('../../miniprogram/pages/onboarding/onboarding');
 const form={...page,data:structuredClone(page.data),setData(update:any){Object.assign(this.data,update);}};
 await form.loadOnboarding();
 assert.equal(form.data.onboarding.template[0].value,'张三'); assert.equal(form.data.onboarding.template[1].value,'女'); assert.equal(form.data.onboarding.template[1].valueIndex,1);
 assert.equal(form.data.onboarding.template[2].value,'');
 assert.deepEqual(form.data.onboarding.template[3].rows[0].values,{学历:'硕士',年份:'2020'}); assert.equal(form.data.onboarding.template[3].rows[0].indexes.学历,1);
 assert.equal(form.onboardingPhotoValue,'data:image/png;base64,abc'); assert.equal(form.data.onboardingHasPhoto,true); assert.equal(form.data.onboarding.previous,undefined); assert.equal(form.data.onboardingSignature,''); assert.equal(form.data.declarationAccepted,false);
});
