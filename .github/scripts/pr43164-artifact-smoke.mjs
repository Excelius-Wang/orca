import { createRequire } from 'node:module'
import { join, dirname, resolve } from 'node:path'
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { once } from 'node:events'
import assert from 'node:assert/strict'
const root=process.cwd()
const require=createRequire(join(root,'package.json'))
const { createPackageWithOptions, statFile }=require('@electron/asar')
const { forkProcess }=require('@orca/process-host/fork-process')
const config=require('./config/electron-builder.config.cjs')
const scratch=resolve('../orca-validation/desktop-artifact')
const stage=join(scratch,'stage')
const seen=new Set()
function stageFile(relative){
 if(seen.has(relative))return
 seen.add(relative)
 const source=join(root,relative),target=join(stage,relative)
 mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target)
 const content=readFileSync(source,'utf8')
 for(const match of content.matchAll(/require\(["'](\.[^"']+)["']\)/g)){
  const child=join(dirname(relative),match[1]);stageFile(child.endsWith('.js')?child:child+'.js')
 }
}
const relative='out/main/repo-worktree-admin-fingerprint-process-entry.js'
stageFile(relative)
writeFileSync(join(stage,'package.json'),'{"name":"orca-fingerprint-artifact-smoke","version":"1.0.0"}')
const archive=join(scratch,'app.asar')
await createPackageWithOptions(stage,archive,{unpack:`{${config.asarUnpack.map(pattern=>join(stage,pattern)).join(',')}}`})
assert.equal(statFile(archive,relative).unpacked,true)
const childPath=join(archive+'.unpacked',relative)
assert.ok(existsSync(childPath))
const repo=join(scratch,'repo');mkdirSync(join(repo,'.git'),{recursive:true});writeFileSync(join(repo,'.git','HEAD'),'abc123\n')
async function smoke(execPath,label,entry=childPath){
 const child=forkProcess({modulePath:entry,execPath,execArgv:[],cwd:dirname(entry),env:{...process.env,ELECTRON_RUN_AS_NODE:'1',ORCA_BACKGROUND_LAUNCH:'1'},stdio:['ignore','ignore','pipe','ipc']})
 let stderr='';child.stderr.on('data',c=>stderr+=c)
 const exited=once(child,'exit')
 const timeout=setTimeout(()=>child.kill('SIGKILL'),10000)
 try{
  const reply=once(child,'message');child.send({id:1,repoPath:repo})
  const [message]=await reply
  assert.deepEqual(message,{id:1,fingerprint:'abc123\u0000y\u0000-\u0000-\u00000'})
  child.disconnect()
  const [code]=await exited;assert.equal(code,0,stderr)
  console.log(`PASS ${label}: packaged child IPC fingerprint correct; clean exit`)
 }finally{clearTimeout(timeout);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')}
}
await smoke(process.execPath,'Node '+process.version)
await smoke(require('electron'),'Electron ELECTRON_RUN_AS_NODE')
console.log('Component packaging smoke only; no desktop application, daemon, or existing profile was started.')

const remote=resolve('../orca-validation/orcad-package')
if(existsSync(join(remote,'.runtime-node'))){
 const hash=readFileSync(join(remote,'.runtime-node'),'utf8').trim()
 const node=join(remote,'..','runtimes','node-'+hash,process.platform==='win32'?'node.exe':'bin/node')
 await smoke(node,'Shipped orcad child under package-pinned Node',join(remote,'repo-worktree-admin-fingerprint-process-entry.js'))
}
