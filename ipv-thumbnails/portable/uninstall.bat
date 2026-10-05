@echo off
setlocal
set "REGSVR=%SystemRoot%\System32\regsvr32.exe"
if exist "%SystemRoot%\Sysnative\regsvr32.exe" set "REGSVR=%SystemRoot%\Sysnative\regsvr32.exe"
set "DEST=%LOCALAPPDATA%\IpvThumb"
if exist "%DEST%\IpvThumb.dll" "%REGSVR%" /u /s "%DEST%\IpvThumb.dll"
del /q "%DEST%\IpvThumb.dll" 2>nul
rmdir "%DEST%" 2>nul
if exist "%DEST%\IpvThumb.dll" (
  echo Unregistered. Windows still has the file open; run this again after
  echo restarting Windows Explorer to delete it.
) else ( echo Uninstalled. )
pause
