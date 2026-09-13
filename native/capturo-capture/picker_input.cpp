#define NOMINMAX
#include <windows.h>
#include <windowsx.h>

#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>

#include "picker_input.h"

namespace {

constexpr UINT_PTR kPulseTimer = 1;
constexpr UINT_PTR kSmokeTimer = 2;
constexpr UINT kPulseMs = 8;
constexpr ULONGLONG kHeartbeatTimeoutMs = 3000;

struct InputEvent {
    const char* kind;
    POINT point;
    int deltaY = 0;
};

struct InputState {
    HWND window = nullptr;
    std::mutex mutex;
    std::condition_variable changed;
    std::deque<InputEvent> actions;
    POINT latestPoint{};
    bool movePending = false;
    bool moveReady = false;
    bool stopping = false;
    std::atomic<ULONGLONG> lastHeartbeat{0};
    bool smoke = false;
    int smokeStep = 0;
    POINT originalCursor{};
    bool originalCursorValid = false;
};

InputState* StateFor(HWND window) {
    return reinterpret_cast<InputState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
}

void QueueEvent(InputState* state, const InputEvent& event) {
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->actions.size() >= 256) {
        // Never let a stalled parent turn this desktop-wide input window into a backlog.
        PostMessageW(state->window, WM_CLOSE, 0, 0);
        return;
    }
    state->actions.push_back(event);
    state->changed.notify_one();
}

void WriteEvents(InputState* state) {
    while (true) {
        InputEvent event{};
        {
            std::unique_lock<std::mutex> lock(state->mutex);
            state->changed.wait(lock, [&] {
                return state->stopping || !state->actions.empty() || state->moveReady;
            });
            if (state->stopping) return;
            if (!state->actions.empty()) {
                event = state->actions.front();
                state->actions.pop_front();
            } else {
                event = {"move", state->latestPoint, 0};
                state->movePending = false;
                state->moveReady = false;
            }
        }
        if (event.deltaY != 0) {
            std::fprintf(stdout, "{\"kind\":\"%s\",\"x\":%ld,\"y\":%ld,\"deltaY\":%d}\n",
                event.kind, event.point.x, event.point.y, event.deltaY);
        } else {
            std::fprintf(stdout, "{\"kind\":\"%s\",\"x\":%ld,\"y\":%ld}\n",
                event.kind, event.point.x, event.point.y);
        }
        if (std::fflush(stdout) != 0) {
            PostMessageW(state->window, WM_CLOSE, 0, 0);
            return;
        }
    }
}

void ReadHeartbeat(InputState* state) {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line == "ping") state->lastHeartbeat.store(GetTickCount64());
    }
    // The parent closed its pipe or exited. Give input back to the desktop immediately.
    PostMessageW(state->window, WM_CLOSE, 0, 0);
}

void ResizeToVirtualDesktop(HWND window) {
    SetWindowPos(window, HWND_TOPMOST,
        GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
        GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN),
        SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

LRESULT CALLBACK InputWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<CREATESTRUCTW*>(lParam);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
        return TRUE;
    }
    InputState* state = StateFor(window);
    if (!state) return DefWindowProcW(window, message, wParam, lParam);

    switch (message) {
    case WM_SETCURSOR:
        // Cursor ownership is scoped to this window's input thread. No system cursor image or
        // global show count is changed, so a crash cannot leave the user's pointer invisible.
        SetCursor(nullptr);
        return TRUE;
    case WM_MOUSEMOVE: {
        // Reassert the HWND-owned null cursor on every physical movement. A different window's
        // cursor message can otherwise leave one visible frame during a very fast sweep.
        SetCursor(nullptr);
        POINT point{};
        if (GetCursorPos(&point)) {
            std::lock_guard<std::mutex> lock(state->mutex);
            state->latestPoint = point;
            state->movePending = true;
        }
        return 0;
    }
    case WM_MOUSEWHEEL: {
        POINT point{};
        if (GetCursorPos(&point)) {
            QueueEvent(state, {"wheel", point, -GET_WHEEL_DELTA_WPARAM(wParam)});
        }
        return 0;
    }
    case WM_INPUT: {
        // Wheel messages normally go to the focused window, while this input-only surface must
        // stay non-activating so Escape continues to reach the picker. Raw Input delivers the
        // physical wheel to us in the background. The foreground case uses WM_MOUSEWHEEL above.
        if (GET_RAWINPUT_CODE_WPARAM(wParam) == RIM_INPUTSINK) {
            RAWINPUT input{};
            UINT size = sizeof(input);
            if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, &input,
                    &size, sizeof(RAWINPUTHEADER)) == size &&
                input.header.dwType == RIM_TYPEMOUSE &&
                (input.data.mouse.usButtonFlags & RI_MOUSE_WHEEL)) {
                POINT point{};
                if (GetCursorPos(&point)) {
                    const auto delta = static_cast<SHORT>(input.data.mouse.usButtonData);
                    QueueEvent(state, {"wheel", point, -delta});
                }
            }
        }
        return DefWindowProcW(window, message, wParam, lParam);
    }
    case WM_LBUTTONDOWN: {
        POINT point{};
        if (GetCursorPos(&point)) QueueEvent(state, {"pick", point, 0});
        return 0;
    }
    case WM_TIMER:
        if (wParam == kSmokeTimer) {
            if (state->smokeStep == 0) {
                state->originalCursorValid = GetCursorPos(&state->originalCursor) != 0;
                if (state->originalCursorValid) {
                    const int right = GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN);
                    const int nextX = state->originalCursor.x + 24 < right
                        ? state->originalCursor.x + 24 : state->originalCursor.x - 24;
                    const bool moved = SetCursorPos(nextX, state->originalCursor.y) != 0;
                    QueueEvent(state, {"probe", state->originalCursor, moved ? 1 : -1});
                } else {
                    QueueEvent(state, {"probe", {}, -2});
                }
            } else if (state->smokeStep == 1 && state->originalCursorValid) {
                CURSORINFO info{};
                info.cbSize = sizeof(info);
                const bool nullCursor = GetCursorInfo(&info) && info.hCursor == nullptr;
                QueueEvent(state, {"cursor-check", state->originalCursor, nullCursor ? 1 : -1});
                SetCursorPos(state->originalCursor.x, state->originalCursor.y);
            } else if (state->smokeStep >= 2) {
                DestroyWindow(window);
                return 0;
            }
            state->smokeStep++;
            return 0;
        }
        if (wParam == kPulseTimer) {
            if (GetTickCount64() - state->lastHeartbeat.load() > kHeartbeatTimeoutMs) {
                DestroyWindow(window);
                return 0;
            }
            std::lock_guard<std::mutex> lock(state->mutex);
            if (state->movePending) {
                state->moveReady = true;
                state->changed.notify_one();
            }
        }
        return 0;
    case WM_DISPLAYCHANGE:
        ResizeToVirtualDesktop(window);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT paint{};
        BeginPaint(window, &paint);
        EndPaint(window, &paint);
        return 0;
    }
    case WM_CLOSE:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        if (state->smoke && state->originalCursorValid) {
            SetCursorPos(state->originalCursor.x, state->originalCursor.y);
        }
        {
            std::lock_guard<std::mutex> lock(state->mutex);
            state->stopping = true;
        }
        state->changed.notify_one();
        KillTimer(window, kPulseTimer);
        if (state->smoke) KillTimer(window, kSmokeTimer);
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProcW(window, message, wParam, lParam);
    }
}

} // namespace

int RunPickerInputMode(bool smoke) {
    HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = InputWindowProc;
    windowClass.hInstance = instance;
    windowClass.lpszClassName = L"CapturoPickerInputOnly";
    if (!RegisterClassW(&windowClass)) return 1;

    // NOREDIRECTIONBITMAP makes the desktop-wide hit surface visually absent. Windows still
    // hit-tests its full client area, unlike a zero-alpha layered window. The compact Electron
    // window paints the magnifier and is excluded from capture independently.
    auto* state = new InputState();
    state->smoke = smoke;
    state->lastHeartbeat.store(GetTickCount64());
    HWND window = CreateWindowExW(
        WS_EX_NOREDIRECTIONBITMAP | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        windowClass.lpszClassName, L"", WS_POPUP,
        GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
        GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN),
        nullptr, nullptr, instance, state);
    if (!window) return 2;
    state->window = window;
    RAWINPUTDEVICE mouse{};
    mouse.usUsagePage = 0x01;
    mouse.usUsage = 0x02;
    mouse.dwFlags = RIDEV_INPUTSINK;
    mouse.hwndTarget = window;
    if (!RegisterRawInputDevices(&mouse, 1, sizeof(mouse))) {
        DestroyWindow(window);
        return 3;
    }
    ShowWindow(window, SW_SHOWNOACTIVATE);
    ResizeToVirtualDesktop(window);
    SetCursor(nullptr);
    POINT startingPoint{};
    if (GetCursorPos(&startingPoint) && WindowFromPoint(startingPoint) == window) {
        // Ask Windows to reevaluate the cursor for this hit surface before the first user move.
        // A same-point SetCursorPos does not dispatch WM_SETCURSOR; a one-pixel round trip does.
        const int right = GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN);
        const int probeX = startingPoint.x + 1 < right ? startingPoint.x + 1 : startingPoint.x - 1;
        if (SetCursorPos(probeX, startingPoint.y)) SetCursorPos(startingPoint.x, startingPoint.y);
    }
    // Handle the cursor messages generated above before announcing readiness to Electron. They
    // are posted to this window and would otherwise wait behind the ready write below.
    for (int attempt = 0; attempt < 50; ++attempt) {
        MSG pending{};
        while (PeekMessageW(&pending, window, 0, 0, PM_REMOVE)) {
            TranslateMessage(&pending);
            DispatchMessageW(&pending);
        }
        CURSORINFO info{};
        info.cbSize = sizeof(info);
        if (GetCursorInfo(&info) && info.hCursor == nullptr) break;
        Sleep(1);
    }
    SetTimer(window, kPulseTimer, kPulseMs, nullptr);
    if (smoke) SetTimer(window, kSmokeTimer, 80, nullptr);

    CURSORINFO cursorInfo{};
    cursorInfo.cbSize = sizeof(cursorInfo);
    POINT current{};
    GetCursorPos(&current);
    HWND hit = WindowFromPoint(current);
    const bool cursorHidden = GetCursorInfo(&cursorInfo) && !(cursorInfo.flags & CURSOR_SHOWING);
    std::printf("{\"kind\":\"ready\",\"cursorHidden\":%s,\"nullCursor\":%s,\"inputHit\":%s}\n",
        cursorHidden ? "true" : "false", cursorInfo.hCursor == nullptr ? "true" : "false",
        hit == window ? "true" : "false");
    std::fflush(stdout);
    std::thread(WriteEvents, state).detach();
    std::thread(ReadHeartbeat, state).detach();

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    // The OS tears down the two pipe workers with this short-lived helper process. State remains
    // allocated until process exit so neither worker can touch freed memory during shutdown.
    return 0;
}
