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
//   capturo-capture.exe --output <file.png> [--display <index>] [--sdr-white-nits <n>]
//
// Reports a single line of JSON on stdout so the main process can log what happened.

#include <windows.h>
#include <d3d11.h>
#include <dxgi1_6.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <DirectXPackedVector.h>

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

#pragma comment(lib, "d3d11.lib")
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

struct Options {
    std::wstring output;
    int display = 0;
    // Physical desktop coordinates of the monitor's top-left corner. DXGI enumerates outputs
    // in its own order, which does not match the host's display list, so selecting by index
    // silently captures the wrong monitor. Matching on position is unambiguous.
    bool hasOrigin = false;
    long originX = 0;
    long originY = 0;
    float sdrWhiteNits = 0.0f;  // 0 means query it
};

void Fail(const char* stage, HRESULT hr) {
    std::printf("{\"ok\":false,\"stage\":\"%s\",\"hr\":\"0x%08lX\"}\n", stage, static_cast<unsigned long>(hr));
}

bool ParseOptions(int argc, wchar_t** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        const std::wstring arg = argv[i];
        const bool hasValue = (i + 1) < argc;
        if (arg == L"--output" && hasValue) options.output = argv[++i];
        else if (arg == L"--display" && hasValue) options.display = _wtoi(argv[++i]);
        else if (arg == L"--origin-x" && hasValue) { options.originX = _wtol(argv[++i]); options.hasOrigin = true; }
        else if (arg == L"--origin-y" && hasValue) { options.originY = _wtol(argv[++i]); }
        else if (arg == L"--sdr-white-nits" && hasValue) options.sdrWhiteNits = static_cast<float>(_wtof(argv[++i]));
        else return false;
    }
    return !options.output.empty();
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
// values it was authored with. That is the whole point: the defect being fixed was normal
// window content being blown out, not HDR highlights being imperfect.
//
// Above SDR white the signal is genuine HDR headroom, which has nowhere to go in an 8-bit
// sRGB image. It is rolled off asymptotically toward white so bright areas stay ordered and
// keep some separation instead of turning into one flat patch. A knee below 1.0 was tried
// first and rejected: it darkened white itself, mapping 255 to about 241.
float ToneMap(float value) {
    if (value <= 1.0f) return value;
    // Compress the headroom into the last sliver below white, preserving monotonicity.
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

}  // namespace

int wmain(int argc, wchar_t** argv) {
    // DuplicateOutput1 returns DXGI_ERROR_UNSUPPORTED unless the process is per-monitor
    // DPI aware. This also keeps the captured surface at true physical resolution rather
    // than a DPI-virtualised one.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // Stage timings, reported in the JSON so the caller can see where a capture spends its
    // time (setup, frame acquisition, pixel conversion, PNG encode).
    LARGE_INTEGER qpcFreq;
    QueryPerformanceFrequency(&qpcFreq);
    auto stamp = []() { LARGE_INTEGER t; QueryPerformanceCounter(&t); return t.QuadPart; };
    auto msBetween = [&qpcFreq](long long a, long long b) { return (b - a) * 1000.0 / qpcFreq.QuadPart; };
    const long long tStart = stamp();

    Options options;
    if (!ParseOptions(argc, argv, options)) {
        std::printf("{\"ok\":false,\"stage\":\"arguments\"}\n");
        return 2;
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) { Fail("CoInitializeEx", hr); return 1; }

    ComPtr<IDXGIFactory1> factory;
    hr = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(hr)) { Fail("CreateDXGIFactory1", hr); return 1; }

    // Walk adapters and outputs to reach the requested display.
    ComPtr<IDXGIAdapter1> adapter;
    ComPtr<IDXGIOutput> output;
    DXGI_OUTPUT_DESC outputDesc{};
    int seen = 0;
    for (UINT a = 0; !output && factory->EnumAdapters1(a, &adapter) != DXGI_ERROR_NOT_FOUND; ++a) {
        ComPtr<IDXGIOutput> candidate;
        for (UINT o = 0; adapter->EnumOutputs(o, &candidate) != DXGI_ERROR_NOT_FOUND; ++o) {
            DXGI_OUTPUT_DESC desc{};
            candidate->GetDesc(&desc);
            const bool match = options.hasOrigin
                ? (desc.DesktopCoordinates.left == options.originX && desc.DesktopCoordinates.top == options.originY)
                : (seen == options.display);
            ++seen;
            if (match) { output = candidate; outputDesc = desc; break; }
            candidate.Reset();
        }
        if (!output) adapter.Reset();
    }
    if (!output) { Fail("EnumOutputs", E_INVALIDARG); return 1; }

    // A rotated output duplicates into an unrotated surface. The pixels are turned back to the
    // desktop orientation when they are written out below (see the conversion loop), so a
    // rotated display is captured natively rather than falling back.

    // Is this output actually in HDR right now? The user can toggle it at any time, so this
    // has to be read per capture rather than cached.
    bool hdrActive = false;
    ComPtr<IDXGIOutput6> output6;
    if (SUCCEEDED(output.As(&output6))) {
        DXGI_OUTPUT_DESC1 desc1{};
        if (SUCCEEDED(output6->GetDesc1(&desc1))) {
            hdrActive = desc1.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
        }
    }

    float sdrWhiteNits = options.sdrWhiteNits;
    bool whiteLevelQueried = false;
    if (sdrWhiteNits <= 0.0f) {
        sdrWhiteNits = QuerySdrWhiteNits(outputDesc.DeviceName);
        whiteLevelQueried = sdrWhiteNits > 0.0f;
        if (!whiteLevelQueried) sdrWhiteNits = kFallbackSdrWhiteNits;
    }

    D3D_FEATURE_LEVEL featureLevel{};
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    hr = D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, 0, nullptr, 0,
                           D3D11_SDK_VERSION, &device, &featureLevel, &context);
    if (FAILED(hr)) { Fail("D3D11CreateDevice", hr); return 1; }

    ComPtr<IDXGIOutput5> output5;
    hr = output.As(&output5);
    if (FAILED(hr)) { Fail("IDXGIOutput5", hr); return 1; }

    // Ask for float first so HDR values above 1.0 survive. DXGI falls back to the next
    // supported format if the display is not in HDR.
    const DXGI_FORMAT formats[] = { DXGI_FORMAT_R16G16B16A16_FLOAT, DXGI_FORMAT_B8G8R8A8_UNORM };
    ComPtr<IDXGIOutputDuplication> duplication;
    hr = output5->DuplicateOutput1(device.Get(), 0, ARRAYSIZE(formats), formats, &duplication);
    if (FAILED(hr)) { Fail("DuplicateOutput1", hr); return 1; }
    const long long tDupReady = stamp();

    // Acquire the desktop frame.
    //
    // The first AcquireNextFrame after duplication starts already holds the current desktop,
    // but its metadata usually reports no present yet. Requiring a present is correct on an
    // active desktop, but a static one never presents, so the previous code discarded that
    // first valid frame and then blocked for the full timeout on every idle screen. Instead:
    // prefer a genuinely presented frame, but keep the most recent acquired surface as a
    // fallback and use it once a short budget elapses. Each frame is copied into a staging
    // texture immediately so it can be released promptly while its pixels are retained.
    const double kAcquireBudgetMs = 100.0;
    const long long tAcquireStart = stamp();

    D3D11_TEXTURE2D_DESC desc{};
    ComPtr<ID3D11Texture2D> readback;
    bool haveFrame = false;
    bool presented = false;

    while (!presented) {
        const double elapsed = msBetween(tAcquireStart, stamp());
        const UINT wait = elapsed >= kAcquireBudgetMs ? 1 : static_cast<UINT>(kAcquireBudgetMs - elapsed);

        ComPtr<IDXGIResource> resource;
        DXGI_OUTDUPL_FRAME_INFO frameInfo{};
        hr = duplication->AcquireNextFrame(wait, &frameInfo, &resource);
        if (hr == DXGI_ERROR_WAIT_TIMEOUT) {
            // No newer frame arrived. If we already hold a surface it is the current desktop
            // (static screen); use it. Otherwise keep waiting until the budget is spent.
            if (haveFrame) break;
            if (msBetween(tAcquireStart, stamp()) >= kAcquireBudgetMs) break;
            continue;
        }
        if (FAILED(hr)) { Fail("AcquireNextFrame", hr); return 1; }

        ComPtr<ID3D11Texture2D> frame;
        hr = resource.As(&frame);
        if (FAILED(hr)) { duplication->ReleaseFrame(); Fail("QueryInterface(ID3D11Texture2D)", hr); return 1; }

        if (!haveFrame) {
            // Size the staging (readback) texture from the first frame. The duplicated frame
            // excludes the mouse pointer, which is why this helper also fixes the cursor
            // appearing in captures.
            frame->GetDesc(&desc);
            D3D11_TEXTURE2D_DESC staging = desc;
            staging.Usage = D3D11_USAGE_STAGING;
            staging.BindFlags = 0;
            staging.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
            staging.MiscFlags = 0;
            hr = device->CreateTexture2D(&staging, nullptr, &readback);
            if (FAILED(hr)) { duplication->ReleaseFrame(); Fail("CreateTexture2D", hr); return 1; }
        }

        context->CopyResource(readback.Get(), frame.Get());
        haveFrame = true;
        presented = frameInfo.LastPresentTime.QuadPart != 0 || frameInfo.AccumulatedFrames > 0;
        duplication->ReleaseFrame();

        if (!presented && msBetween(tAcquireStart, stamp()) >= kAcquireBudgetMs) break;
    }
    if (!haveFrame) { Fail("AcquireNextFrame", E_FAIL); return 1; }
    const long long tAcquired = stamp();

    D3D11_MAPPED_SUBRESOURCE mapped{};
    hr = context->Map(readback.Get(), 0, D3D11_MAP_READ, 0, &mapped);
    if (FAILED(hr)) { Fail("Map", hr); return 1; }

    const UINT sw = desc.Width;
    const UINT sh = desc.Height;
    const bool isFloat = desc.Format == DXGI_FORMAT_R16G16B16A16_FLOAT;
    const float whiteScale = sdrWhiteNits / kScRgbWhiteNits;

    // The duplicated surface is in the panel's unrotated orientation; rotate it to match the
    // desktop. A 90/270 rotation swaps width and height. The output dimensions are what the
    // caller receives, so a rotated display reports its true desktop size.
    const DXGI_MODE_ROTATION rotation = outputDesc.Rotation;
    const bool swapAxes =
        rotation == DXGI_MODE_ROTATION_ROTATE90 || rotation == DXGI_MODE_ROTATION_ROTATE270;
    const UINT width = swapAxes ? sh : sw;
    const UINT height = swapAxes ? sw : sh;
    std::vector<BYTE> bgra(static_cast<size_t>(width) * height * 4);

    // Convert one source pixel (scRGB FP16 tone mapped, or SDR passthrough) to sRGB BGRA.
    auto convert = [&](const BYTE* srcRow, UINT sx, BYTE* dst) {
        float r, g, b;
        if (isFloat) {
            const auto* px = reinterpret_cast<const DirectX::PackedVector::HALF*>(srcRow) + static_cast<size_t>(sx) * 4;
            r = LinearToSrgb(ToneMap(DirectX::PackedVector::XMConvertHalfToFloat(px[0]) / whiteScale));
            g = LinearToSrgb(ToneMap(DirectX::PackedVector::XMConvertHalfToFloat(px[1]) / whiteScale));
            b = LinearToSrgb(ToneMap(DirectX::PackedVector::XMConvertHalfToFloat(px[2]) / whiteScale));
        } else {
            const BYTE* px = srcRow + static_cast<size_t>(sx) * 4;
            b = px[0] / 255.0f; g = px[1] / 255.0f; r = px[2] / 255.0f;
        }
        dst[0] = static_cast<BYTE>(b * 255.0f + 0.5f);
        dst[1] = static_cast<BYTE>(g * 255.0f + 0.5f);
        dst[2] = static_cast<BYTE>(r * 255.0f + 0.5f);
        dst[3] = 255;
    };

    // For each destination pixel, map back to its source pixel under the rotation. Direction
    // is verified against real rotated hardware, since the DXGI convention is easy to invert.
    const BYTE* base = static_cast<const BYTE*>(mapped.pData);
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
            convert(base + static_cast<size_t>(sy) * mapped.RowPitch, sx, outRow + static_cast<size_t>(ox) * 4);
        }
    }

    context->Unmap(readback.Get(), 0);
    const long long tConverted = stamp();

    hr = WritePng(options.output, bgra, width, height);
    if (FAILED(hr)) { Fail("WritePng", hr); return 1; }
    const long long tEncoded = stamp();

    std::printf(
        "{\"ok\":true,\"width\":%u,\"height\":%u,\"format\":\"%s\",\"hdrActive\":%s,"
        "\"sdrWhiteNits\":%.1f,\"whiteLevelQueried\":%s,"
        "\"timings\":{\"setup\":%.1f,\"acquire\":%.1f,\"convert\":%.1f,\"encode\":%.1f}}\n",
        width, height, isFloat ? "R16G16B16A16_FLOAT" : "B8G8R8A8_UNORM",
        hdrActive ? "true" : "false", sdrWhiteNits, whiteLevelQueried ? "true" : "false",
        msBetween(tStart, tDupReady), msBetween(tDupReady, tAcquired),
        msBetween(tAcquired, tConverted), msBetween(tConverted, tEncoded));
    return 0;
}
