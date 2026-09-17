'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const {TARGETS,stamp}=require('./native-manifest');
const root=path.join(__dirname,'..');
for(const target of TARGETS){
  const run=spawnSync('cargo',['build','--release','--locked'],{cwd:path.join(root,target.dir),stdio:'inherit',windowsHide:true});
  if(run.error||run.status!==0){console.error(run.error?.message||'Native-bygg feilet: '+target.dir);process.exit(run.status||1);}
  stamp(root,target);
}
require('./check-native');
