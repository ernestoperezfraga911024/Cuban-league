'use strict';
const fs = require('node:fs/promises'),path = require('node:path'),os = require('node:os');
const {spawn} = require('node:child_process');
const {constants} = require('node:fs');
// Kernel lock shared by all runs/checkouts in this execution environment. Never
// unlink it or steal it because of age, a scheduler status, or a partial checkpoint.
async function acquireRunnerLock() {
  const file = path.join(os.tmpdir(),'cuban-league-forecast-'+process.getuid()+'.lock');
  const handle = await fs.open(file,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  const stat = await handle.stat();
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o077)) {
    await handle.close();throw Error('Unsafe forecast runner lock');
  }
  // flock takes the already verified inode on fd3, without reopening a path.
  // Its child holds the lock while the parent keeps stdin open; SIGKILL/exit also
  // closes that pipe, so there is no stale PID/TTL or guessed cleanup protocol.
  const child = spawn('flock',['--no-fork','--nonblock','--conflict-exit-code','73','/proc/self/fd/3',process.execPath,'-e',
    "process.stdout.write('locked\\n');process.stdin.resume();"],{stdio:['pipe','pipe','pipe',handle.fd]});
  child.stdin.on('error',()=>{});
  let held=false,errors='',released=false;
  child.stderr.on('data',data=>{errors=(errors+data).slice(-2000);});
  const done=new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('close',code=>{held=false;resolve({code});});});
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{child.kill();reject(Error('Runner lock acquisition timed out'));},5000);
      let text='';
      child.stdout.on('data',data=>{text+=data;if(text==='locked\n'){held=true;clearTimeout(timer);resolve();}});
      done.then(({code,error})=>{clearTimeout(timer);const failure=Error(code===73?'Another forecast runner is still active; no SQL or reading started':error?.message||'Runner lock failed: '+errors);failure.code=code===73?'RUNNER_BUSY':'RUNNER_LOCK_FAILED';reject(failure);});
    });
  } catch(error) {child.stdin.end();await done;throw error;}
  finally {await handle.close();}
  return {
    assertHeld(){if(!held||released)throw Error('Runner lock lost; stop and reread database state before resuming');},
    async release(){if(released)return;released=true;child.stdin.end();await done;}
  };
}
module.exports={acquireRunnerLock};
