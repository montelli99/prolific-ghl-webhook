'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const cp=require('node:child_process');

const root=path.resolve(__dirname,'..');
const target=process.argv[2]&&path.resolve(process.argv[2]);
if(!target)throw Error('Usage: node scripts/build-ppc-worker-distribution.cjs <target-directory>');

const entry='ppc-team-note-service.cjs';
const files=new Set();
function collect(relative){
  if(files.has(relative))return;
  const absolute=path.join(root,relative);
  if(!fs.existsSync(absolute))throw Error(`Missing local dependency ${relative}`);
  files.add(relative);
  const source=fs.readFileSync(absolute,'utf8');
  for(const match of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g)){
    let dependency=match[1].slice(2);
    if(!path.extname(dependency))dependency+='.js';
    collect(dependency);
  }
}
collect(entry);

fs.mkdirSync(target,{recursive:true});
for(const relative of [...files].sort()){
  const destination=path.join(target,relative);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.copyFileSync(path.join(root,relative),destination);
}
const commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const manifest={source_repository:'montelli99/prolific-ghl-webhook',source_commit:commit,entry,
  files:[...files].sort().map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}))};
fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({target,source_commit:commit,files:manifest.files.length}));
