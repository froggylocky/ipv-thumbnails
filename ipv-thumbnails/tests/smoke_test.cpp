// smoke_test.cpp - loads IpvThumb.dll directly (no registration needed), asks it
// for a 256px thumbnail the same way Explorer does, and checks the result.
//
//   smoke_test.exe IpvThumb.dll file.ipv <width> <height>   expect a thumbnail of that size
//   smoke_test.exe IpvThumb.dll file.ipv fail               expect the file to be rejected
//
// Valid samples from make_samples.py have a red top-left and blue bottom-right
// quadrant, so a flipped or mirrored thumbnail fails the test.
// Explorer only ever uses the HBITMAP through GDI, so the test reads it back the
// same way (GetDIBits) rather than poking at the DIB section's memory.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlwapi.h>
#include <thumbcache.h>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <vector>

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "user32.lib")   // GetDC / ReleaseDC

// Must match IpvThumbnailProvider.cpp
static const CLSID CLSID_IpvThumbProvider =
    {0xe2295ade, 0xdfc3, 0x4202, {0xb1, 0x61, 0x77, 0xfb, 0xc0, 0x78, 0x5a, 0xd6}};

typedef HRESULT(STDAPICALLTYPE* GetClassObjectFn)(REFCLSID, REFIID, void**);

static int Fail(const char* what, HRESULT hr) {
    std::printf("FAIL: %s (hr=0x%08lx)\n", what, (unsigned long)hr);
    return 1;
}

int wmain(int argc, wchar_t** argv) {
    if (argc < 4) {
        std::printf("usage: smoke_test IpvThumb.dll file.ipv <width> <height> | fail\n");
        return 2;
    }
    // Unbuffered output, so messages survive even if something crashes.
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    const bool expectFail = std::wcscmp(argv[3], L"fail") == 0;
    int ew = 0, eh = 0;
    if (!expectFail) {
        if (argc < 5) return Fail("missing expected height", E_INVALIDARG);
        ew = _wtoi(argv[3]);
        eh = _wtoi(argv[4]);
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) return Fail("CoInitializeEx", hr);

    HMODULE dll = LoadLibraryW(argv[1]);
    if (!dll) return Fail("LoadLibrary", HRESULT_FROM_WIN32(GetLastError()));
    auto getClassObject = (GetClassObjectFn)GetProcAddress(dll, "DllGetClassObject");
    if (!getClassObject) return Fail("DllGetClassObject export missing", E_FAIL);

    IClassFactory* factory = nullptr;
    hr = getClassObject(CLSID_IpvThumbProvider, IID_PPV_ARGS(&factory));
    if (FAILED(hr)) return Fail("DllGetClassObject", hr);

    IInitializeWithStream* init = nullptr;
    hr = factory->CreateInstance(nullptr, IID_PPV_ARGS(&init));
    factory->Release();
    if (FAILED(hr)) return Fail("CreateInstance", hr);

    IStream* stream = nullptr;
    hr = SHCreateStreamOnFileEx(argv[2], STGM_READ | STGM_SHARE_DENY_NONE, FILE_ATTRIBUTE_NORMAL,
                                FALSE, nullptr, &stream);
    if (FAILED(hr)) return Fail("open sample file", hr);
    hr = init->Initialize(stream, STGM_READ);
    stream->Release();
    if (FAILED(hr)) return Fail("Initialize", hr);

    IThumbnailProvider* provider = nullptr;
    hr = init->QueryInterface(IID_PPV_ARGS(&provider));
    init->Release();
    if (FAILED(hr)) return Fail("QueryInterface(IThumbnailProvider)", hr);

    HBITMAP hbmp = nullptr;
    WTS_ALPHATYPE alpha = WTSAT_UNKNOWN;
    hr = provider->GetThumbnail(256, &hbmp, &alpha);
    provider->Release();

    if (expectFail) {
        if (SUCCEEDED(hr)) {
            if (hbmp) DeleteObject(hbmp);
            std::printf("FAIL: %ls produced a thumbnail but should have been rejected\n", argv[2]);
            return 1;
        }
        std::printf("OK: %ls rejected cleanly (hr=0x%08lx)\n", argv[2], (unsigned long)hr);
        return 0;
    }
    if (FAILED(hr) || !hbmp) return Fail("GetThumbnail", hr);

    DIBSECTION ds = {};
    if (GetObjectW(hbmp, sizeof(ds), &ds) != sizeof(ds)) return Fail("result is not a DIB section", E_FAIL);
    const int w = ds.dsBm.bmWidth, h = std::abs(ds.dsBm.bmHeight);
    if (w != ew || h != eh) {
        std::printf("FAIL: thumbnail is %dx%d, expected %dx%d\n", w, h, ew, eh);
        return 1;
    }
    // Ask GDI for the pixels as top-down 32-bit BGRA in our own buffer. (Don't
    // inspect the DIB section directly: GetObject reports a positive height even
    // for top-down DIBs, so the row order can't be inferred from it.)
    std::vector<BYTE> pixels((size_t)w * h * 4);
    BITMAPINFO bi = {};
    bi.bmiHeader.biSize        = sizeof(BITMAPINFOHEADER);
    bi.bmiHeader.biWidth       = w;
    bi.bmiHeader.biHeight      = -h;                      // request top-down rows
    bi.bmiHeader.biPlanes      = 1;
    bi.bmiHeader.biBitCount    = 32;
    bi.bmiHeader.biCompression = BI_RGB;
    HDC dc = GetDC(nullptr);
    const int lines = GetDIBits(dc, hbmp, 0, (UINT)h, pixels.data(), &bi, DIB_RGB_COLORS);
    ReleaseDC(nullptr, dc);
    DeleteObject(hbmp);                                    // safe: we only use our copy now
    if (lines != h) return Fail("GetDIBits", E_FAIL);
    auto px = [&](int x, int y) { return &pixels[((size_t)y * w + x) * 4]; };   // BGRA
    const BYTE* tl = px(2, 2);
    const BYTE* br = px(w - 3, h - 3);
    const bool tlRed  = tl[2] > 200 && tl[1] < 60 && tl[0] < 60;
    const bool brBlue = br[0] > 200 && br[1] < 60 && br[2] < 60;
    if (!tlRed || !brBlue) {
        std::printf("FAIL: wrong colours/orientation. top-left BGRA=%d,%d,%d bottom-right BGRA=%d,%d,%d\n",
                    tl[0], tl[1], tl[2], br[0], br[1], br[2]);
        return 1;
    }
    if (alpha != WTSAT_ARGB) return Fail("alpha type was not WTSAT_ARGB", E_FAIL);
    std::printf("OK: %ls -> %dx%d thumbnail, correct orientation\n", argv[2], w, h);
    return 0;
}
