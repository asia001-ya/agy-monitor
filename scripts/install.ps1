# Windows PowerShell 一键安装脚本，透传全部参数至 Node 安装程序
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallJs = Join-Path $ScriptDir 'install.mjs'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error '未检测到 Node.js，请先安装 Node.js 18+ 后重试。'
  exit 1
}

& node $InstallJs @ForwardArgs
exit $LASTEXITCODE
