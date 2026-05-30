$hook = conda shell.powershell hook
Invoke-Expression ($hook -join "`n")
conda activate meta
$env:PYTHONUNBUFFERED = '1'
$env:PLAYBOOK_GRAPH_CACHE_ENABLED = 'true'
Set-Location 'C:\prog\YellowStorm-poc\yellowstorm-adk'
python -u -m main *> 'C:\prog\YellowStorm-poc\.tmp\adk-phase5.log' 2> 'C:\prog\YellowStorm-poc\.tmp\adk-phase5.err.log'
