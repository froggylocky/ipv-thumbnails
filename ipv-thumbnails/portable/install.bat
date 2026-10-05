@echo off
rem Installs the .ipv thumbnail handler for the current user (no admin needed).
setlocal
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=arm64"
set "REGSVR=%SystemRoot%\System32\regsvr32.exe"
if exist "%SystemRoot%\Sysnative\regsvr32.exe" set "REGSVR=%SystemRoot%\Sysnative\regsvr32.exe"
set "DEST=%LOCALAPPDATA%\IpvThumb"

if not exist "%~dp0%ARCH%\IpvThumb.dll" ( echo %ARCH%\IpvThumb.dll is missing from this folder. & pause & exit /b 1 )
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0%ARCH%\IpvThumb.dll" "%DEST%\IpvThumb.dll" >nul || (
  echo Could not replace the DLL because Windows is using it.
  echo Restart Windows Explorer from Task Manager, then run this again.
  pause & exit /b 1
)
"%REGSVR%" /s "%DEST%\IpvThumb.dll" || ( echo Registration failed. & pause & exit /b 1 )
echo Installed (%ARCH%). Open a folder with .ipv files in Medium icons view or larger.
pause
