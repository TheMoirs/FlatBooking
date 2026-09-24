require('dotenv').config();
const { spawn } = require('child_process');

const child = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: '3010' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d.toString(); });
child.stderr.on('data', (d) => { stderr += d.toString(); });

setTimeout(async () => {
  try {
    const response = await fetch('http://localhost:3010/api/availability?from=2026-09-24&to=2026-10-24');
    const text = await response.text();
    console.log('STATUS=' + response.status);
    console.log(text.slice(0, 500));
  } catch (err) {
    console.error('FETCH_ERR=' + err.message);
    console.error(stderr || stdout);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
  }
}, 2000);
