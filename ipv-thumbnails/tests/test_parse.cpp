// test_parse.cpp - runs the exact parser the DLL uses, on any OS.
//   g++ -std=c++17 -O2 -I.. test_parse.cpp -o test_parse
//   ./test_parse file.ipv [out.png]
#include <cstdio>
#include <vector>
#include "ipv_parse.h"

struct FileReader {
    FILE* f;
    long reads = 0;
    bool operator()(uint64_t off, void* buf, uint32_t len) {
        ++reads;
        if (std::fseek(f, long(off), SEEK_SET) != 0) return false;
        return std::fread(buf, 1, len, f) == len;
    }
};

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: %s file.ipv [out.png]\n", argv[0]); return 2; }
    FILE* f = std::fopen(argv[1], "rb");
    if (!f) { std::perror(argv[1]); return 2; }
    std::fseek(f, 0, SEEK_END);
    uint64_t size = uint64_t(std::ftell(f));
    FileReader rd{f};
    ipv::Span s;
    if (!ipv::find_composite(rd, size, s)) {
        std::printf("no composite found (%ld reads)\n", rd.reads);
        return 1;
    }
    std::printf("composite PNG at 0x%llx, %u bytes (%ld reads)\n",
                (unsigned long long)s.offset, s.length, rd.reads);
    if (argc > 2) {
        std::vector<unsigned char> buf(s.length);
        rd(s.offset, buf.data(), s.length);
        FILE* o = std::fopen(argv[2], "wb");
        std::fwrite(buf.data(), 1, buf.size(), o);
        std::fclose(o);
    }
    std::fclose(f);
    return 0;
}
