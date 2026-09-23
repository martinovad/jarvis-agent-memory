Open the JARVIS token-usage dashboard (rendered from the token ledger) in the default browser.

Steps:
1. Run the PowerShell tool to regenerate the dashboard from the current ledger, then open it:
```powershell
$vault = if ($env:JARVIS_VAULT_PATH) { $env:JARVIS_VAULT_PATH } else { "C:\Users\<you>\Documents\JARVIS-Vault" }
$dash = "$vault\System\JARVIS\Metrics\dashboard.html"
$proj = if ($env:JARVIS_PROJECT_PATH) { $env:JARVIS_PROJECT_PATH } else { "C:\Users\<you>\Active Projects\Jarvis" }
node "$proj\mcp\scripts\token-report.js" --html > $null 2>&1
if (Test-Path $dash) { Invoke-Item $dash; "OPENED: $dash" } else { "MISSING: $dash (run a session save first to populate the ledger)" }
```
2. Report the opened path (or the missing-file message). No other commentary.
