'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {stamp,check}=require('../scripts/native-manifest');
test('native-manifest reagerer på innhold, ikke checkout-tid, og oppdager feil binær',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gw2-native-test-')),target={dir:'helper',file:'helper.exe'};
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'helper/src'),{recursive:true});fs.mkdirSync(path.join(root,'helper/target/release'),{recursive:true});
  for(const f of ['Cargo.toml','Cargo.lock','src/main.rs','target/release/helper.exe'])fs.writeFileSync(path.join(root,'helper',f),'synthetic');
  stamp(root,target);check(root,target);fs.utimesSync(path.join(root,'helper/src/main.rs'),new Date(),new Date());check(root,target);
  fs.appendFileSync(path.join(root,'helper/src/main.rs'),'change');assert.throws(()=>check(root,target));
  stamp(root,target);fs.appendFileSync(path.join(root,'helper/target/release/helper.exe'),'change');assert.throws(()=>check(root,target));
});
