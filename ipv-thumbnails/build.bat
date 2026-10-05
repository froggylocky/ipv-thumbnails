@echo off
rem Optional local build (GitHub Actions does this automatically).
rem Run from "x64 Native Tools Command Prompt for VS".
where cl >nul 2>nul || ( echo Open "x64 Native Tools Command Prompt for VS" and run this again. & exit /b 1 )
cd /d "%~dp0"
if not exist out mkdir out
cl /nologo /O2 /EHsc /W3 /std:c++17 /DUNICODE /D_UNICODE /LD src\IpvThumbnailProvider.cpp /Foout\ ^
   /link /DEF:src\IpvThumb.def /OUT:out\IpvThumb.dll || exit /b 1
echo Built out\IpvThumb.dll
