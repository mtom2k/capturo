@echo off
REM Builds the HDR capture helper. Requires the MSVC toolchain and the Windows SDK, which
REM come from the "Desktop development with C++" workload of Visual Studio Build Tools.
REM
REM Output: build\capturo-capture.exe, copied into the app by electron-builder.

setlocal

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo ERROR: vswhere not found. Install Visual Studio Build Tools with the
  echo        "Desktop development with C++" workload, then run this again.
  exit /b 1
)

for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"
if not defined VSPATH (
  echo ERROR: no MSVC C++ toolset found. Install the "Desktop development with C++"
  echo        workload, which also supplies the Windows SDK.
  exit /b 1
)

REM vcvars64.bat calls vswhere by bare name, so put the VS Installer directory (which is not
REM on PATH by default) ahead of it. Without this the build still works, but vcvars prints a
REM harmless "'vswhere.exe' is not recognized" to stderr that looks like a failure.
set "PATH=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer;%PATH%"

call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 exit /b 1

if not exist "%~dp0build" mkdir "%~dp0build"

cl /nologo /std:c++17 /O2 /EHsc /W4 /DUNICODE /D_UNICODE ^
   /Fe:"%~dp0build\capturo-capture.exe" ^
   /Fo:"%~dp0build\\" ^
   "%~dp0main.cpp"
if errorlevel 1 exit /b 1

echo Built %~dp0build\capturo-capture.exe
endlocal
