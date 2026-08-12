// capturo-capture: HDR-aware screen capture helper for Windows.
//
// Chromium's capture pipeline converts the desktop to 8-bit before Capturo can see it. On
// an HDR display that conversion clamps scRGB values above 1.0, which blows out ordinary
// UI: measured on a 200 nit SDR white level, everything above roughly 60% grey collapsed
// to pure white. See D-014.
//
// This helper keeps the frame in DXGI_FORMAT_R16G16B16A16_FLOAT from capture through to
// tone mapping, then writes a normal sRGB PNG.
//
// Two modes:
//   One-shot (testing / fallback):
//     capturo-capture.exe --output <file.png> [--origin-x X --origin-y Y] [--sdr-white-nits N]
//   Serve (how Capturo drives it): no arguments. Reads one request per line from stdin:
//     "<originX>\t<originY>\t<outputPath>" captures a display and
//     "window-border\t<nativeHandle>" suppresses DWM's frame border for recording chrome.
//     One JSON result line is written per request. The Direct3D device and DXGI desktop
//     duplication are kept alive across requests. See D-017 and D-021.
//
// Every result is a single line of JSON on stdout.

#include <windows.h>
#include <dwmapi.h>
#include <d3d11.h>
#include <dxgi1_6.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <DirectXPackedVector.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <map>
#include <string>
#include <utility>
#include <vector>

#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "dxgi.lib")
#pragma comment(lib, "windowscodecs.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

namespace {

// scRGB defines 1.0 as 80 nits. Windows then renders ordinary SDR content at its own
// reference white, so SDR white sits at sdrWhiteNits / 80 in the captured buffer.
constexpr float kScRgbWhiteNits = 80.0f;

// Used when Windows will not report the SDR white level. Measured on the development
// display; the value there was 200 nits, giving a scale of 2.5.
constexpr float kFallbackSdrWhiteNits = 200.0f;

// Budget for waiting on a genuinely presented frame before falling back to the current
// surface. Bounds latency on a static desktop that never presents. See D-015.
constexpr double kAcquireBudgetMs = 100.0;

LARGE_INTEGER g_qpcFreq{};
long long NowQpc() { LARGE_INTEGER t; QueryPerformanceCounter(&t); return t.QuadPart; }
double MsBetween(long long a, long long b) { return (b - a) * 1000.0 / g_qpcFreq.QuadPart; }

struct Options {
    std::wstring output;
    long originX = 0;
    long originY = 0;
    float sdrWhiteNits = 0.0f;  // 0 means query it
};

bool ParseOptions(int argc, wchar_t** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        const std::wstring arg = argv[i];
        const bool hasValue = (i + 1) < argc;
        if (arg == L"--output" && hasValue) options.output = argv[++i];
        else if (arg == L"--origin-x" && hasValue) options.originX = _wtol(argv[++i]);
        else if (arg == L"--origin-y" && hasValue) options.originY = _wtol(argv[++i]);
        else if (arg == L"--sdr-white-nits" && hasValue) options.sdrWhiteNits = static_cast<float>(_wtof(argv[++i]));
        else return false;
    }
    return !options.output.empty();
}

std::wstring Utf8ToWide(const std::string& s) {
    if (s.empty()) return L"";
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring w(static_cast<size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), w.data(), n);
    return w;
}

// Windows exposes the SDR reference white through the display configuration APIs. The
// legacy query fails on some Windows 11 builds (observed returning ERROR_GEN_FAILURE on
// build 26200), so the caller must be prepared for this to return 0.
float QuerySdrWhiteNits(const std::wstring& deviceName) {
    UINT32 pathCount = 0, modeCount = 0;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &pathCount, &modeCount) != ERROR_SUCCESS) return 0.0f;

    std::vector<DISPLAYCONFIG_PATH_INFO> paths(pathCount);
    std::vector<DISPLAYCONFIG_MODE_INFO> modes(modeCount);
    if (QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &pathCount, paths.data(), &modeCount, modes.data(), nullptr) != ERROR_SUCCESS) {
        return 0.0f;
    }
    paths.resize(pathCount);

    for (const auto& path : paths) {
        // Match the path back to the DXGI output via its GDI device name.
        DISPLAYCONFIG_SOURCE_DEVICE_NAME source{};
        source.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
        source.header.size = sizeof(source);
        source.header.adapterId = path.sourceInfo.adapterId;
        source.header.id = path.sourceInfo.id;
        if (DisplayConfigGetDeviceInfo(&source.header) != ERROR_SUCCESS) continue;
        if (deviceName != source.viewGdiDeviceName) continue;

        DISPLAYCONFIG_SDR_WHITE_LEVEL white{};
        white.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL;
        white.header.size = sizeof(white);
        white.header.adapterId = path.targetInfo.adapterId;
        white.header.id = path.targetInfo.id;
        if (DisplayConfigGetDeviceInfo(&white.header) != ERROR_SUCCESS) return 0.0f;
        // SDRWhiteLevel is reported as (nits / 80) * 1000.
        return (static_cast<float>(white.SDRWhiteLevel) / 1000.0f) * kScRgbWhiteNits;
    }
    return 0.0f;
}

// Everything at or below SDR white is reproduced exactly, so ordinary UI comes out with the
// values it was authored with. Above SDR white the signal is genuine HDR headroom, rolled off
// asymptotically toward white so bright areas stay ordered instead of turning into one flat
// patch. See D-015.
float ToneMap(float value) {
    if (value <= 1.0f) return value;
    constexpr float kHeadroom = 0.02f;
    return 1.0f - kHeadroom / value;
}

float LinearToSrgb(float value) {
    if (value <= 0.0f) return 0.0f;
    if (value >= 1.0f) return 1.0f;
    return value <= 0.0031308f ? value * 12.92f : 1.055f * std::pow(value, 1.0f / 2.4f) - 0.055f;
}

HRESULT WritePng(const std::wstring& path, const std::vector<BYTE>& bgra, UINT width, UINT height) {
    ComPtr<IWICImagingFactory> factory;
    HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory));
    if (FAILED(hr)) return hr;

    ComPtr<IWICStream> stream;
    hr = factory->CreateStream(&stream);
    if (FAILED(hr)) return hr;
    hr = stream->InitializeFromFilename(path.c_str(), GENERIC_WRITE);
    if (FAILED(hr)) return hr;

    ComPtr<IWICBitmapEncoder> encoder;
    hr = factory->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder);
    if (FAILED(hr)) return hr;
    hr = encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache);
    if (FAILED(hr)) return hr;

    ComPtr<IWICBitmapFrameEncode> frame;
    hr = encoder->CreateNewFrame(&frame, nullptr);
    if (FAILED(hr)) return hr;
    hr = frame->Initialize(nullptr);
    if (FAILED(hr)) return hr;
    hr = frame->SetSize(width, height);
    if (FAILED(hr)) return hr;

    WICPixelFormatGUID format = GUID_WICPixelFormat32bppBGRA;
    hr = frame->SetPixelFormat(&format);
    if (FAILED(hr)) return hr;
    hr = frame->WritePixels(height, width * 4, static_cast<UINT>(bgra.size()), const_cast<BYTE*>(bgra.data()));
    if (FAILED(hr)) return hr;
    hr = frame->Commit();
    if (FAILED(hr)) return hr;
    return encoder->Commit();
}

// ---- Persistent capture session -------------------------------------------------------

// Per-output cached state. The duplication and the readback staging texture are kept alive
// across captures. `readback` also holds the last desktop frame, so a static screen that
// never presents can reuse it instead of failing to acquire.
struct OutputCapture {
    ComPtr<IDXGIOutput5> output5;
    DXGI_OUTPUT_DESC desc{};
    uint64_t luid = 0;
    ComPtr<IDXGIOutputDuplication> dup;
    ComPtr<ID3D11Texture2D> readback;
    D3D11_TEXTURE2D_DESC frameDesc{};
    bool hasFrame = false;
};

struct DeviceEntry {
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
};

struct Capturer {
    ComPtr<IDXGIFactory1> factory;
    std::map<uint64_t, DeviceEntry> devices;               // keyed by adapter LUID
    std::map<std::pair<long, long>, OutputCapture> outputs; // keyed by desktop origin
};

struct CaptureResult {
    bool ok = false;
    const char* stage = nullptr;
    HRESULT hr = S_OK;
    bool deviceLost = false;
    UINT width = 0, height = 0;
    bool isFloat = false;
    bool hdrActive = false;
    float sdrWhiteNits = 0.0f;
    bool whiteLevelQueried = false;
    double tSetup = 0, tAcquire = 0, tConvert = 0, tEncode = 0;
};

enum class Attempt { Ok, Rebuild, Fatal };

std::string SerializeResult(const CaptureResult& r) {
    char buf[512];
    if (r.ok) {
        std::snprintf(buf, sizeof(buf),
            "{\"ok\":true,\"width\":%u,\"height\":%u,\"format\":\"%s\",\"hdrActive\":%s,"
            "\"sdrWhiteNits\":%.1f,\"whiteLevelQueried\":%s,"
            "\"timings\":{\"setup\":%.1f,\"acquire\":%.1f,\"convert\":%.1f,\"encode\":%.1f}}",
            r.width, r.height, r.isFloat ? "R16G16B16A16_FLOAT" : "B8G8R8A8_UNORM",
            r.hdrActive ? "true" : "false", r.sdrWhiteNits, r.whiteLevelQueried ? "true" : "false",
            r.tSetup, r.tAcquire, r.tConvert, r.tEncode);
    } else {
        std::snprintf(buf, sizeof(buf), "{\"ok\":false,\"stage\":\"%s\",\"hr\":\"0x%08lX\"}",
            r.stage ? r.stage : "unknown", static_cast<unsigned long>(r.hr));
    }
    return std::string(buf);
}

// Rebuild the DXGI factory if it is stale (display topology changed). A fresh factory means
// the enumerated outputs may have changed, so the per-output cache is dropped.
HRESULT EnsureFactory(Capturer& cap) {
    if (cap.factory && cap.factory->IsCurrent()) return S_OK;
    const bool had = static_cast<bool>(cap.factory);
    cap.factory.Reset();
    HRESULT hr = CreateDXGIFactory1(IID_PPV_ARGS(&cap.factory));
    if (SUCCEEDED(hr) && had) cap.outputs.clear();
    return hr;
}

bool FindOutput(IDXGIFactory1* factory, long ox, long oy,
                ComPtr<IDXGIAdapter1>& outAdapter, ComPtr<IDXGIOutput>& outOutput, DXGI_OUTPUT_DESC& outDesc) {
    ComPtr<IDXGIAdapter1> adapter;
    for (UINT a = 0; factory->EnumAdapters1(a, &adapter) != DXGI_ERROR_NOT_FOUND; ++a) {
        ComPtr<IDXGIOutput> candidate;
        for (UINT o = 0; adapter->EnumOutputs(o, &candidate) != DXGI_ERROR_NOT_FOUND; ++o) {
            DXGI_OUTPUT_DESC d{};
            candidate->GetDesc(&d);
            if (d.DesktopCoordinates.left == ox && d.DesktopCoordinates.top == oy) {
                outAdapter = adapter;
                outOutput = candidate;
                outDesc = d;
                return true;
            }
            candidate.Reset();
        }
        adapter.Reset();
    }
    return false;
}

bool OutputHdrActive(IDXGIOutput5* output5) {
    ComPtr<IDXGIOutput6> output6;
    if (SUCCEEDED(output5->QueryInterface(IID_PPV_ARGS(&output6)))) {
        DXGI_OUTPUT_DESC1 desc1{};
        if (SUCCEEDED(output6->GetDesc1(&desc1))) {
            return desc1.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
        }
    }
    return false;
}

// Creates (or recreates) the duplication for one output: finds it by origin, gets-or-creates
// a device on its adapter, and starts desktop duplication. Fills the OutputCapture cache.
Attempt BuildOutput(Capturer& cap, long ox, long oy, OutputCapture& oc, CaptureResult& r) {
    const long long t0 = NowQpc();
    if (FAILED(EnsureFactory(cap))) { r.stage = "CreateDXGIFactory1"; return Attempt::Fatal; }

    ComPtr<IDXGIAdapter1> adapter;
    ComPtr<IDXGIOutput> output;
    DXGI_OUTPUT_DESC desc{};
    if (!FindOutput(cap.factory.Get(), ox, oy, adapter, output, desc)) { r.stage = "EnumOutputs"; return Attempt::Fatal; }

    DXGI_ADAPTER_DESC1 ad{};
    adapter->GetDesc1(&ad);
    const uint64_t luid = (static_cast<uint64_t>(static_cast<uint32_t>(ad.AdapterLuid.HighPart)) << 32) |
                          static_cast<uint32_t>(ad.AdapterLuid.LowPart);

    DeviceEntry& dev = cap.devices[luid];
    if (!dev.device) {
        D3D_FEATURE_LEVEL featureLevel{};
        HRESULT hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, nullptr, 0,
                                       D3D11_SDK_VERSION, &dev.device, &featureLevel, &dev.context);
        if (FAILED(hr)) { cap.devices.erase(luid); r.stage = "D3D11CreateDevice"; r.hr = hr; return Attempt::Fatal; }
    }

    ComPtr<IDXGIOutput5> output5;
    HRESULT hr = output.As(&output5);
    if (FAILED(hr)) { r.stage = "IDXGIOutput5"; r.hr = hr; return Attempt::Fatal; }

    // Ask for float first so HDR values above 1.0 survive; DXGI falls back to 8-bit on SDR.
    const DXGI_FORMAT formats[] = { DXGI_FORMAT_R16G16B16A16_FLOAT, DXGI_FORMAT_B8G8R8A8_UNORM };
    ComPtr<IDXGIOutputDuplication> dup;
    hr = output5->DuplicateOutput1(dev.device.Get(), 0, ARRAYSIZE(formats), formats, &dup);
    if (hr == DXGI_ERROR_DEVICE_REMOVED || hr == DXGI_ERROR_DEVICE_RESET) { r.deviceLost = true; return Attempt::Rebuild; }
    if (FAILED(hr)) { r.stage = "DuplicateOutput1"; r.hr = hr; return Attempt::Fatal; }

    oc.output5 = output5;
    oc.desc = desc;
    oc.luid = luid;
    oc.dup = dup;
    oc.readback.Reset();
    oc.hasFrame = false;
    r.tSetup = MsBetween(t0, NowQpc());
    return Attempt::Ok;
}

// Acquires the current desktop into oc.readback. On an active desktop this pulls the newest
// frame; on a static one where AcquireNextFrame times out, it reuses the last frame already in
// oc.readback (nothing changed). Recoverable losses return Rebuild.
Attempt AcquireLatest(OutputCapture& oc, ID3D11Device* device, ID3D11DeviceContext* context, CaptureResult& r) {
    const long long start = NowQpc();
    bool gotNew = false;
    for (;;) {
        const double elapsed = MsBetween(start, NowQpc());
        const UINT wait = elapsed >= kAcquireBudgetMs ? 1 : static_cast<UINT>(kAcquireBudgetMs - elapsed);

        ComPtr<IDXGIResource> resource;
        DXGI_OUTDUPL_FRAME_INFO info{};
        HRESULT hr = oc.dup->AcquireNextFrame(wait, &info, &resource);
        if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
            if (gotNew || oc.hasFrame) break;
            if (MsBetween(start, NowQpc()) >= kAcquireBudgetMs) break;
            continue;
        }
        if (hr == DXGI_ERROR_ACCESS_LOST) return Attempt::Rebuild;
        if (hr == DXGI_ERROR_DEVICE_REMOVED || hr == DXGI_ERROR_DEVICE_RESET) { r.deviceLost = true; return Attempt::Rebuild; }
        if (FAILED(hr)) { r.stage = "AcquireNextFrame"; r.hr = hr; return Attempt::Fatal; }

        ComPtr<ID3D11Texture2D> frame;
        hr = resource.As(&frame);
        if (FAILED(hr)) { oc.dup->ReleaseFrame(); r.stage = "QueryInterface(ID3D11Texture2D)"; r.hr = hr; return Attempt::Fatal; }

        D3D11_TEXTURE2D_DESC fd{};
        frame->GetDesc(&fd);
        if (!oc.readback || oc.frameDesc.Width != fd.Width || oc.frameDesc.Height != fd.Height || oc.frameDesc.Format != fd.Format) {
            D3D11_TEXTURE2D_DESC staging = fd;
            staging.Usage = D3D11_USAGE_STAGING;
            staging.BindFlags = 0;
            staging.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
            staging.MiscFlags = 0;
            ComPtr<ID3D11Texture2D> rb;
            hr = device->CreateTexture2D(&staging, nullptr, &rb);
            if (FAILED(hr)) { oc.dup->ReleaseFrame(); r.stage = "CreateTexture2D"; r.hr = hr; return Attempt::Fatal; }
            oc.readback = rb;
            oc.frameDesc = fd;
        }

        context->CopyResource(oc.readback.Get(), frame.Get());
        oc.hasFrame = true;
        gotNew = true;
        const bool presented = info.LastPresentTime.QuadPart != 0 || info.AccumulatedFrames > 0;
        oc.dup->ReleaseFrame();
        if (presented) break;
        if (MsBetween(start, NowQpc()) >= kAcquireBudgetMs) break;
    }
    if (!gotNew && !oc.hasFrame) { r.stage = "AcquireNextFrame"; r.hr = E_FAIL; return Attempt::Fatal; }
    return Attempt::Ok;
}

// Maps the readback, converts to sRGB BGRA (tone mapping HDR, turning a rotated surface back
// to the desktop orientation), and writes the PNG.
Attempt ProcessToPng(ID3D11DeviceContext* context, OutputCapture& oc, float sdrWhiteNits,
                     const std::wstring& output, CaptureResult& r) {
    D3D11_MAPPED_SUBRESOURCE mapped{};
    HRESULT hr = context->Map(oc.readback.Get(), 0, D3D11_MAP_READ, 0, &mapped);
    if (FAILED(hr)) { r.stage = "Map"; r.hr = hr; return Attempt::Fatal; }

    const long long tc0 = NowQpc();
    const UINT sw = oc.frameDesc.Width;
    const UINT sh = oc.frameDesc.Height;
    const bool isFloat = oc.frameDesc.Format == DXGI_FORMAT_R16G16B16A16_FLOAT;
    const float whiteScale = sdrWhiteNits / kScRgbWhiteNits;

    // A 90/270 rotation swaps width and height; the output dimensions are the desktop's.
    const DXGI_MODE_ROTATION rotation = oc.desc.Rotation;
    const bool swapAxes = rotation == DXGI_MODE_ROTATION_ROTATE90 || rotation == DXGI_MODE_ROTATION_ROTATE270;
    const UINT width = swapAxes ? sh : sw;
    const UINT height = swapAxes ? sw : sh;
    std::vector<BYTE> bgra(static_cast<size_t>(width) * height * 4);

    auto convert = [&](const BYTE* srcRow, UINT sx, BYTE* dst) {
        float rr, gg, bb;
        if (isFloat) {
            const auto* px = reinterpret_cast<const DirectX::PackedVector::HALF*>(srcRow) + static_cast<size_t>(sx) * 4;
            rr = LinearToSrgb(ToneMap(DirectX::PackedVector::XMConvertHalfToFloat(px[0]) / whiteScale));
            gg = LinearToSrgb(ToneMap(DirectX::PackedVector::XMConvertHalfToFloat(px[1]) / whiteScale));
            bb = LinearToSrgb(ToneMap(DirectX::PackedVector::XMConvertHalfToFloat(px[2]) / whiteScale));
        } else {
            const BYTE* px = srcRow + static_cast<size_t>(sx) * 4;
            bb = px[0] / 255.0f; gg = px[1] / 255.0f; rr = px[2] / 255.0f;
        }
        dst[0] = static_cast<BYTE>(bb * 255.0f + 0.5f);
        dst[1] = static_cast<BYTE>(gg * 255.0f + 0.5f);
        dst[2] = static_cast<BYTE>(rr * 255.0f + 0.5f);
        dst[3] = 255;
    };

    const BYTE* baseRow = static_cast<const BYTE*>(mapped.pData);
    for (UINT oy = 0; oy < height; ++oy) {
        BYTE* outRow = bgra.data() + static_cast<size_t>(oy) * width * 4;
        for (UINT ox = 0; ox < width; ++ox) {
            UINT sx, sy;
            switch (rotation) {
                case DXGI_MODE_ROTATION_ROTATE90:  sx = oy;          sy = sh - 1 - ox; break;
                case DXGI_MODE_ROTATION_ROTATE270: sx = sw - 1 - oy; sy = ox;          break;
                case DXGI_MODE_ROTATION_ROTATE180: sx = sw - 1 - ox; sy = sh - 1 - oy; break;
                default:                           sx = ox;          sy = oy;          break;
            }
            convert(baseRow + static_cast<size_t>(sy) * mapped.RowPitch, sx, outRow + static_cast<size_t>(ox) * 4);
        }
    }

    context->Unmap(oc.readback.Get(), 0);
    const long long tc1 = NowQpc();

    hr = WritePng(output, bgra, width, height);
    if (FAILED(hr)) { r.stage = "WritePng"; r.hr = hr; return Attempt::Fatal; }
    const long long tc2 = NowQpc();

    r.width = width;
    r.height = height;
    r.isFloat = isFloat;
    r.tConvert = MsBetween(tc0, tc1);
    r.tEncode = MsBetween(tc1, tc2);
    return Attempt::Ok;
}

Attempt CaptureAttempt(Capturer& cap, long ox, long oy, const std::wstring& output, float requestedNits, CaptureResult& r) {
    OutputCapture& oc = cap.outputs[std::make_pair(ox, oy)];
    if (!oc.dup) {
        const Attempt a = BuildOutput(cap, ox, oy, oc, r);
        if (a != Attempt::Ok) return a;
    }

    auto it = cap.devices.find(oc.luid);
    if (it == cap.devices.end() || !it->second.device) { r.deviceLost = true; return Attempt::Rebuild; }
    ID3D11Device* device = it->second.device.Get();
    ID3D11DeviceContext* context = it->second.context.Get();

    // HDR state and SDR white are re-read per capture; the user can toggle them any time.
    r.hdrActive = OutputHdrActive(oc.output5.Get());
    float nits = requestedNits;
    if (nits <= 0.0f) {
        nits = QuerySdrWhiteNits(oc.desc.DeviceName);
        r.whiteLevelQueried = nits > 0.0f;
        if (!r.whiteLevelQueried) nits = kFallbackSdrWhiteNits;
    }
    r.sdrWhiteNits = nits;

    const long long ta0 = NowQpc();
    Attempt a = AcquireLatest(oc, device, context, r);
    if (a != Attempt::Ok) return a;
    r.tAcquire = MsBetween(ta0, NowQpc());

    return ProcessToPng(context, oc, nits, output, r);
}

// One capture, printing exactly one JSON result line. Retries once on a recoverable loss,
// rebuilding the affected duplication (or the whole device on device-removed).
void CaptureOne(Capturer& cap, long ox, long oy, const std::wstring& output, float requestedNits) {
    CaptureResult r;
    Attempt a = CaptureAttempt(cap, ox, oy, output, requestedNits, r);
    if (a == Attempt::Rebuild) {
        if (r.deviceLost) { cap.devices.clear(); cap.outputs.clear(); }
        else cap.outputs.erase(std::make_pair(ox, oy));
        r = CaptureResult{};
        a = CaptureAttempt(cap, ox, oy, output, requestedNits, r);
    }
    r.ok = a == Attempt::Ok;
    if (!r.ok && !r.stage) r.stage = "rebuild";

    const std::string json = SerializeResult(r);
    std::fputs(json.c_str(), stdout);
    std::fputc('\n', stdout);
    std::fflush(stdout);
}

// Best-effort: pre-open duplication for every current output so the first real capture is
// already warm. Failures are ignored; the capture path rebuilds as needed.
void WarmUp(Capturer& cap) {
    if (FAILED(EnsureFactory(cap))) return;
    ComPtr<IDXGIAdapter1> adapter;
    for (UINT a = 0; cap.factory->EnumAdapters1(a, &adapter) != DXGI_ERROR_NOT_FOUND; ++a) {
        ComPtr<IDXGIOutput> output;
        for (UINT o = 0; adapter->EnumOutputs(o, &output) != DXGI_ERROR_NOT_FOUND; ++o) {
            DXGI_OUTPUT_DESC d{};
            output->GetDesc(&d);
            const long ox = d.DesktopCoordinates.left;
            const long oy = d.DesktopCoordinates.top;
            OutputCapture& oc = cap.outputs[std::make_pair(ox, oy)];
            if (!oc.dup) {
                CaptureResult r;
                BuildOutput(cap, ox, oy, oc, r);
            }
            output.Reset();
        }
        adapter.Reset();
    }
}

// Windows can draw DWM-owned non-client pixels even when Electron creates a transparent,
// frameless window with thickFrame:false. Disable non-client rendering completely, then also
// set Windows 11's border colour to NONE. Neither setting affects Capturo's client-area CSS.
void SuppressWindowBorder(unsigned long long rawHandle) {
    HWND window = reinterpret_cast<HWND>(static_cast<uintptr_t>(rawHandle));
    if (!IsWindow(window)) {
        std::fputs("{\"ok\":false,\"stage\":\"window\"}\n", stdout);
        std::fflush(stdout);
        return;
    }

    const DWMNCRENDERINGPOLICY policy = DWMNCRP_DISABLED;
    const HRESULT policyResult = DwmSetWindowAttribute(
        window,
        DWMWA_NCRENDERING_POLICY,
        &policy,
        sizeof(policy));

    constexpr DWORD kDwmwaBorderColor = 34;
    constexpr COLORREF kDwmwaColorNone = 0xFFFFFFFE;
    const COLORREF color = kDwmwaColorNone;
    const HRESULT borderResult = DwmSetWindowAttribute(
        window,
        static_cast<DWMWINDOWATTRIBUTE>(kDwmwaBorderColor),
        &color,
        sizeof(color));
    if (SUCCEEDED(policyResult) || SUCCEEDED(borderResult)) {
        std::fputs("{\"ok\":true}\n", stdout);
    } else {
        std::printf(
            "{\"ok\":false,\"stage\":\"DwmSetWindowAttribute\","
            "\"policyHr\":\"0x%08lX\",\"borderHr\":\"0x%08lX\"}\n",
            static_cast<unsigned long>(policyResult),
            static_cast<unsigned long>(borderResult));
    }
    std::fflush(stdout);
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    // DuplicateOutput1 returns DXGI_ERROR_UNSUPPORTED unless the process is per-monitor DPI
    // aware. This also keeps the captured surface at true physical resolution.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    QueryPerformanceFrequency(&g_qpcFreq);

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) { std::printf("{\"ok\":false,\"stage\":\"CoInitializeEx\",\"hr\":\"0x%08lX\"}\n", static_cast<unsigned long>(hr)); return 1; }

    Capturer cap;

    // One-shot mode: any arguments mean a single --output capture (testing and fallback).
    if (argc > 1) {
        Options options;
        if (!ParseOptions(argc, argv, options)) { std::printf("{\"ok\":false,\"stage\":\"arguments\"}\n"); return 2; }
        CaptureOne(cap, options.originX, options.originY, options.output, options.sdrWhiteNits);
        return 0;
    }

    // Serve mode: the device and duplication are created once and reused. Capture and window
    // styling requests share the line-oriented protocol; one JSON result per line out.
    WarmUp(cap);
    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) continue;
        const size_t t1 = line.find('\t');
        if (t1 != std::string::npos && line.substr(0, t1) == "window-border") {
            const unsigned long long handle = std::strtoull(line.substr(t1 + 1).c_str(), nullptr, 10);
            SuppressWindowBorder(handle);
            continue;
        }
        const size_t t2 = t1 == std::string::npos ? std::string::npos : line.find('\t', t1 + 1);
        if (t1 == std::string::npos || t2 == std::string::npos) {
            std::fputs("{\"ok\":false,\"stage\":\"request\"}\n", stdout);
            std::fflush(stdout);
            continue;
        }
        const long ox = std::strtol(line.substr(0, t1).c_str(), nullptr, 10);
        const long oy = std::strtol(line.substr(t1 + 1, t2 - t1 - 1).c_str(), nullptr, 10);
        const std::wstring output = Utf8ToWide(line.substr(t2 + 1));
        CaptureOne(cap, ox, oy, output, 0.0f);
    }
    return 0;
}
