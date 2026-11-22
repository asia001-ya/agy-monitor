@echo off
setlocal
chcp 65001 >nul

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 未检测到 Node.js，无法执行卸载脚本。
  echo.
  set "EXIT_CODE=1"
  goto :done
)

node "%~dp0scripts\uninstall.mjs" %*
set "EXIT_CODE=%ERRORLEVEL%"

:done
if "%~1"=="" (
  echo %cmdcmdline% | find /i "/c ""%~f0""" >nul
  if not errorlevel 1 (
    echo.
    pause
  )
)
exit /b %EXIT_CODE%
