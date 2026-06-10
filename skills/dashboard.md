Open the JARVIS token-usage dashboard (rendered from the token ledger) in the default browser.

Steps:
1. Run the PowerShell tool to regenerate the dashboard from the current ledger, then open it:
```powershell
$vault = if ($env:JARVIS_VAULT_PATH) { $env:JARVIS_VAULT_PATH } else { "C:\Users\marti\Documents\JARVIS-Vault" }
$dash = "$vault\System\JARVIS\Metrics\dashboard.html"
node "C:\Users\marti\Active Projects\Jarvis\mcp\scripts\token-report.js" --html > $null 2>&1
if (Test-Path $dash) { Invoke-Item $dash; "OPENED: $dash" } else { "MISSING: $dash (run a session save first to populate the ledger)" }
```
2. Report the opened path (or the missing-file message). No other commentary.
