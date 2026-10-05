// IpvThumbnailProvider.cpp - Windows Explorer thumbnail handler for ibisPaint .ipv files.
//
// Explorer hands us the file as an IStream. We find the flattened artwork PNG
// (see ipv_parse.h), decode it with the Windows Imaging Component that ships
// with Windows, and return an HBITMAP. No third-party libraries.
//
// Registration is per-user (HKCU), so installing does not need admin rights.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <thumbcache.h>
#include <wincodec.h>
#include <cwchar>
#include <new>
#include <vector>
#include "ipv_parse.h"

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "windowscodecs.lib")

// {E2295ADE-DFC3-4202-B161-77FBC0785AD6}
static const CLSID CLSID_IpvThumbProvider =
    {0xe2295ade, 0xdfc3, 0x4202, {0xb1, 0x61, 0x77, 0xfb, 0xc0, 0x78, 0x5a, 0xd6}};
static const wchar_t kClsidStr[]   = L"{E2295ADE-DFC3-4202-B161-77FBC0785AD6}";
static const wchar_t kHandlerName[] = L"ibisPaint IPV Thumbnail Handler";
// Well-known shell key that means "IThumbnailProvider for this file type".
static const wchar_t kThumbShellEx[] = L"ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}";

static HMODULE g_module = nullptr;
static long    g_dllRefs = 0;

// ---------------------------------------------------------------- stream reader
struct StreamReader {
    IStream* s;
    bool operator()(uint64_t off, void* buf, uint32_t len) {
        LARGE_INTEGER li;
        li.QuadPart = (LONGLONG)off;
        if (FAILED(s->Seek(li, STREAM_SEEK_SET, nullptr))) return false;
        BYTE* p = (BYTE*)buf;
        while (len) {
            ULONG got = 0;
            HRESULT hr = s->Read(p, len, &got);
            if (FAILED(hr) || got == 0) return false;
            p += got;
            len -= got;
        }
        return true;
    }
};

// ------------------------------------------------------- PNG -> HBITMAP via WIC
template <class T> static void SafeRelease(T*& p) { if (p) { p->Release(); p = nullptr; } }

static HRESULT DecodePngToHBitmap(IStream* png, UINT cx, HBITMAP* out, WTS_ALPHATYPE* alpha) {
    IWICImagingFactory*    factory = nullptr;
    IWICBitmapDecoder*     decoder = nullptr;
    IWICBitmapFrameDecode* frame   = nullptr;
    IWICBitmapScaler*      scaler  = nullptr;
    IWICFormatConverter*   conv    = nullptr;
    UINT w = 0, h = 0, tw = 0, th = 0;

    HRESULT hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(&factory));
    if (SUCCEEDED(hr)) hr = factory->CreateDecoderFromStream(png, nullptr, WICDecodeMetadataCacheOnDemand, &decoder);
    if (SUCCEEDED(hr)) hr = decoder->GetFrame(0, &frame);
    if (SUCCEEDED(hr)) hr = frame->GetSize(&w, &h);
    if (SUCCEEDED(hr) && (w == 0 || h == 0)) hr = E_FAIL;
    if (SUCCEEDED(hr)) {
        tw = w; th = h;
        if (cx > 0 && (w > cx || h > cx)) {             // fit inside cx x cx, keep aspect ratio
            if (w >= h) { tw = cx; th = (UINT)((UINT64)h * cx / w); }
            else        { th = cx; tw = (UINT)((UINT64)w * cx / h); }
            if (tw == 0) tw = 1;
            if (th == 0) th = 1;
        }
        hr = factory->CreateBitmapScaler(&scaler);
    }
    if (SUCCEEDED(hr)) hr = scaler->Initialize(frame, tw, th, WICBitmapInterpolationModeFant);
    if (SUCCEEDED(hr)) hr = factory->CreateFormatConverter(&conv);
    if (SUCCEEDED(hr)) hr = conv->Initialize(scaler, GUID_WICPixelFormat32bppBGRA,
                                             WICBitmapDitherTypeNone, nullptr, 0.0,
                                             WICBitmapPaletteTypeCustom);
    if (SUCCEEDED(hr)) {
        BITMAPINFO bi = {};
        bi.bmiHeader.biSize        = sizeof(BITMAPINFOHEADER);
        bi.bmiHeader.biWidth       = (LONG)tw;
        bi.bmiHeader.biHeight      = -(LONG)th;          // negative = top-down rows
        bi.bmiHeader.biPlanes      = 1;
        bi.bmiHeader.biBitCount    = 32;
        bi.bmiHeader.biCompression = BI_RGB;
        void* bits = nullptr;
        HBITMAP hbmp = CreateDIBSection(nullptr, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
        if (!hbmp) {
            hr = E_OUTOFMEMORY;
        } else {
            hr = conv->CopyPixels(nullptr, tw * 4, tw * 4 * th, (BYTE*)bits);
            if (SUCCEEDED(hr)) { *out = hbmp; *alpha = WTSAT_ARGB; }
            else DeleteObject(hbmp);
        }
    }
    SafeRelease(conv); SafeRelease(scaler); SafeRelease(frame);
    SafeRelease(decoder); SafeRelease(factory);
    return hr;
}

// ------------------------------------------------------------ the provider
class IpvThumbProvider : public IInitializeWithStream, public IThumbnailProvider {
    long     m_ref = 1;
    IStream* m_stream = nullptr;
public:
    IpvThumbProvider()  { InterlockedIncrement(&g_dllRefs); }
    virtual ~IpvThumbProvider() { SafeRelease(m_stream); InterlockedDecrement(&g_dllRefs); }

    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        static const QITAB qit[] = {
            QITABENT(IpvThumbProvider, IInitializeWithStream),
            QITABENT(IpvThumbProvider, IThumbnailProvider),
            {nullptr, 0},
        };
        return QISearch(this, qit, riid, ppv);
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&m_ref); }
    IFACEMETHODIMP_(ULONG) Release() override {
        long r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return r;
    }

    // IInitializeWithStream
    IFACEMETHODIMP Initialize(IStream* stream, DWORD) override {
        if (m_stream) return HRESULT_FROM_WIN32(ERROR_ALREADY_INITIALIZED);
        return stream->QueryInterface(IID_PPV_ARGS(&m_stream));
    }

    // IThumbnailProvider
    IFACEMETHODIMP GetThumbnail(UINT cx, HBITMAP* phbmp, WTS_ALPHATYPE* pdwAlpha) override {
        if (!phbmp || !pdwAlpha) return E_POINTER;
        *phbmp = nullptr;
        *pdwAlpha = WTSAT_UNKNOWN;
        if (!m_stream) return E_UNEXPECTED;

        STATSTG st = {};
        HRESULT hr = m_stream->Stat(&st, STATFLAG_NONAME);
        if (FAILED(hr)) return hr;

        StreamReader rd{m_stream};
        ipv::Span span;
        if (!ipv::find_composite(rd, st.cbSize.QuadPart, span)) return E_FAIL;

        std::vector<BYTE> png;
        try { png.resize(span.length); } catch (...) { return E_OUTOFMEMORY; }
        if (!rd(span.offset, png.data(), span.length)) return E_FAIL;

        IStream* mem = SHCreateMemStream(png.data(), (UINT)png.size());
        if (!mem) return E_OUTOFMEMORY;
        hr = DecodePngToHBitmap(mem, cx, phbmp, pdwAlpha);
        mem->Release();
        return hr;
    }
};

// ------------------------------------------------------------ class factory
class ClassFactory : public IClassFactory {
    long m_ref = 1;
public:
    ClassFactory()  { InterlockedIncrement(&g_dllRefs); }
    virtual ~ClassFactory() { InterlockedDecrement(&g_dllRefs); }

    IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
        static const QITAB qit[] = { QITABENT(ClassFactory, IClassFactory), {nullptr, 0} };
        return QISearch(this, qit, riid, ppv);
    }
    IFACEMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&m_ref); }
    IFACEMETHODIMP_(ULONG) Release() override {
        long r = InterlockedDecrement(&m_ref);
        if (r == 0) delete this;
        return r;
    }
    IFACEMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        IpvThumbProvider* p = new (std::nothrow) IpvThumbProvider();
        if (!p) return E_OUTOFMEMORY;
        HRESULT hr = p->QueryInterface(riid, ppv);
        p->Release();
        return hr;
    }
    IFACEMETHODIMP LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&g_dllRefs); else InterlockedDecrement(&g_dllRefs);
        return S_OK;
    }
};

// ------------------------------------------------------------ registry helpers
static HRESULT SetRegString(const wchar_t* subkey, const wchar_t* name, const wchar_t* value) {
    HKEY key;
    LONG r = RegCreateKeyExW(HKEY_CURRENT_USER, subkey, 0, nullptr, REG_OPTION_NON_VOLATILE,
                             KEY_SET_VALUE, nullptr, &key, nullptr);
    if (r != ERROR_SUCCESS) return HRESULT_FROM_WIN32(r);
    r = RegSetValueExW(key, name, 0, REG_SZ, (const BYTE*)value,
                       (DWORD)((wcslen(value) + 1) * sizeof(wchar_t)));
    RegCloseKey(key);
    return HRESULT_FROM_WIN32(r);
}

// Delete a ShellEx key only if it points at our handler (don't clobber others).
static void DeleteIfOurs(const wchar_t* subkey) {
    wchar_t val[64] = {};
    DWORD cb = sizeof(val);
    if (RegGetValueW(HKEY_CURRENT_USER, subkey, nullptr, RRF_RT_REG_SZ, nullptr, val, &cb) == ERROR_SUCCESS &&
        _wcsicmp(val, kClsidStr) == 0)
        RegDeleteTreeW(HKEY_CURRENT_USER, subkey);
}

static void BuildKey(wchar_t* out, size_t n, const wchar_t* a, const wchar_t* b, const wchar_t* c = L"") {
    wnsprintfW(out, (int)n, L"%s%s%s", a, b, c);
}

// ------------------------------------------------------------ DLL exports
BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = module;
        DisableThreadLibraryCalls(module);
    }
    return TRUE;
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (!IsEqualCLSID(clsid, CLSID_IpvThumbProvider)) return CLASS_E_CLASSNOTAVAILABLE;
    ClassFactory* cf = new (std::nothrow) ClassFactory();
    if (!cf) return E_OUTOFMEMORY;
    HRESULT hr = cf->QueryInterface(riid, ppv);
    cf->Release();
    return hr;
}

STDAPI DllCanUnloadNow() { return g_dllRefs == 0 ? S_OK : S_FALSE; }

STDAPI DllRegisterServer() {
    wchar_t path[MAX_PATH];
    if (!GetModuleFileNameW(g_module, path, MAX_PATH)) return HRESULT_FROM_WIN32(GetLastError());

    wchar_t key[256];
    HRESULT hr;
    BuildKey(key, 256, L"Software\\Classes\\CLSID\\", kClsidStr);
    hr = SetRegString(key, nullptr, kHandlerName);
    if (SUCCEEDED(hr)) {
        BuildKey(key, 256, L"Software\\Classes\\CLSID\\", kClsidStr, L"\\InprocServer32");
        hr = SetRegString(key, nullptr, path);
        if (SUCCEEDED(hr)) hr = SetRegString(key, L"ThreadingModel", L"Apartment");
    }
    // Hook .ipv both directly and via SystemFileAssociations, so it works whether
    // or not some app has set its own ProgID for .ipv.
    if (SUCCEEDED(hr)) {
        BuildKey(key, 256, L"Software\\Classes\\.ipv\\", kThumbShellEx);
        hr = SetRegString(key, nullptr, kClsidStr);
    }
    if (SUCCEEDED(hr)) {
        BuildKey(key, 256, L"Software\\Classes\\SystemFileAssociations\\.ipv\\", kThumbShellEx);
        hr = SetRegString(key, nullptr, kClsidStr);
    }
    if (SUCCEEDED(hr)) SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
    return hr;
}

STDAPI DllUnregisterServer() {
    wchar_t key[256];
    BuildKey(key, 256, L"Software\\Classes\\.ipv\\", kThumbShellEx);
    DeleteIfOurs(key);
    BuildKey(key, 256, L"Software\\Classes\\SystemFileAssociations\\.ipv\\", kThumbShellEx);
    DeleteIfOurs(key);
    BuildKey(key, 256, L"Software\\Classes\\CLSID\\", kClsidStr);
    RegDeleteTreeW(HKEY_CURRENT_USER, key);
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, nullptr, nullptr);
    return S_OK;
}
