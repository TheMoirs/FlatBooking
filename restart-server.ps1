$procId = (netstat -ano | findstr :3000 | Select-String -Pattern 'LISTENING' -Context 0,0 | Out-String).Trim()
if ($procId) {
  $procId = ($procId -split '\s+')[-1]
  if ($procId -match '^\d+$') { Stop-Process -Id $procId -Force }
}
node server.js
