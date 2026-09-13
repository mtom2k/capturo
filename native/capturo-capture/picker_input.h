#pragma once

// Runs the Windows-only, input-only picker surface. It has no DWM redirection bitmap: the
// Electron magnifier remains a separate compact visual window.
int RunPickerInputMode(bool smoke = false);
