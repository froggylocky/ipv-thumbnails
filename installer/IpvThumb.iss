; Inno Setup script for the .ipv thumbnail handler.
; Built automatically by GitHub Actions. To build locally, put the DLLs in
; dist\x64\ and dist\arm64\ and run:  ISCC /DAppVersion=1.0.0 installer\IpvThumb.iss

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; AppId identifies the installation for upgrades/uninstall. Never change it.
AppId={{8D1B3699-0B40-46A1-9ACF-C12CB39FC266}
AppName=IPV Thumbnails
AppVersion={#AppVersion}
AppVerName=IPV Thumbnails {#AppVersion}
UninstallDisplayName=IPV Thumbnails (ibisPaint previews in File Explorer)
; Per-user install: no admin prompt. Same folder the old install.bat used.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\IpvThumb
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
; Runs on x64 PCs and Windows 11 on ARM (gets the native ARM64 DLL).
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
ChangesAssociations=yes
OutputDir=Output
OutputBaseFilename=IpvThumb-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
Source: "..\dist\x64\IpvThumb.dll";   DestDir: "{app}"; Check: not IsARM64; Flags: ignoreversion
Source: "..\dist\arm64\IpvThumb.dll"; DestDir: "{app}"; Check: IsARM64;     Flags: ignoreversion

[Run]
Filename: "{sys}\regsvr32.exe"; Parameters: "/s ""{app}\IpvThumb.dll"""; \
  Flags: runhidden waituntilterminated; StatusMsg: "Registering the thumbnail handler..."

[UninstallRun]
Filename: "{sys}\regsvr32.exe"; Parameters: "/u /s ""{app}\IpvThumb.dll"""; \
  Flags: runhidden waituntilterminated; RunOnceId: "UnregisterIpvThumb"

[Messages]
FinishedLabel=Thumbnails for ibisPaint .ipv files are now enabled. Open a folder with .ipv files in Medium icons view or larger to see them.
