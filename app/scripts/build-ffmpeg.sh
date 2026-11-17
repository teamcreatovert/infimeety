#!/bin/bash
# Builds the small ffmpeg the desktop app bundles for watch parties (src-tauri/src/convert.rs):
# it reads movies (MKV, MP4, AVI, TS), decodes the sound formats web engines can't play (Dolby
# AC3/E-AC3/TrueHD, DTS) and writes AAC into an MP4, copying the picture untouched. Everything
# else is left out, so it's a few MB instead of the usual 80.
#
#   scripts/build-ffmpeg.sh <target> [out dir]      (from app/; out dir defaults to src-tauri/binaries)
#     x86_64-pc-windows-msvc     in an MSYS2 MINGW64 shell
#     universal-apple-darwin     on a Mac (Apple Silicon and Intel in one file)
#     x86_64-unknown-linux-gnu   on Linux
#
# The output is named the way Tauri's externalBin wants (ffmpeg-<target>[.exe]).
set -euo pipefail

VERSION=7.1.1
SHA256=733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1
TARGET=$1
OUT=$(mkdir -p "${2:-src-tauri/binaries}" && cd "${2:-src-tauri/binaries}" && pwd)
WORK=$(mktemp -d)
JOBS=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o "$WORK/src.tar.xz"
GOT=$( (sha256sum "$WORK/src.tar.xz" 2>/dev/null || shasum -a 256 "$WORK/src.tar.xz") | cut -d' ' -f1)
if [ "$GOT" != "$SHA256" ]; then
  echo "ffmpeg source checksum mismatch: $GOT" >&2
  exit 1
fi
tar -xJf "$WORK/src.tar.xz" -C "$WORK"
SRC="$WORK/ffmpeg-$VERSION"

FLAGS=(
  --disable-everything --disable-autodetect --disable-doc --disable-debug --disable-network --disable-asm
  --disable-programs --enable-ffmpeg --enable-small --disable-avdevice --disable-postproc
  --enable-protocol=file,pipe
  --enable-demuxer=matroska,mov,avi,mpegts,asf,flv,ogg,wav,ac3,eac3,dts,truehd,aac,mp3,flac
  --enable-muxer=mp4,mov,ipod
  --enable-decoder=ac3,eac3,dca,truehd,mlp,aac,aac_latm,mp3,mp2,mp1,flac,vorbis,opus,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s32le,pcm_f32le,pcm_bluray,pcm_dvd
  --enable-encoder=aac
  --enable-parser=h264,hevc,vp8,vp9,av1,mpeg4video,aac,aac_latm,ac3,dca,mlp,mpegaudio,flac,opus,vorbis
  --enable-bsf=aac_adtstoasc,extract_extradata,h264_metadata,hevc_metadata,vp9_superframe
  --enable-filter=aresample,aformat,anull,null,pan,abuffer,abuffersink,buffer,buffersink,format,atrim,trim
)

# Configures and builds in its own folder; prints the binary's path.
build() {
  local dir="$WORK/build-$1"
  shift
  mkdir -p "$dir"
  (cd "$dir" && "$SRC/configure" "${FLAGS[@]}" "$@" >/dev/null && make -j"$JOBS" ffmpeg >/dev/null) >&2
  if [ -f "$dir/ffmpeg.exe" ]; then echo "$dir/ffmpeg.exe"; else echo "$dir/ffmpeg"; fi
}

case "$TARGET" in
  x86_64-pc-windows-msvc)
    # Static: no MinGW runtime DLLs to ship next to it.
    BIN=$(build win --extra-ldflags=-static)
    cp "$BIN" "$OUT/ffmpeg-$TARGET.exe"
    ;;
  universal-apple-darwin)
    ARM=$(build arm --enable-cross-compile --target-os=darwin --arch=arm64 --extra-cflags="-arch arm64 -mmacosx-version-min=11.0" --extra-ldflags="-arch arm64 -mmacosx-version-min=11.0")
    X86=$(build x86 --enable-cross-compile --target-os=darwin --arch=x86_64 --extra-cflags="-arch x86_64 -mmacosx-version-min=11.0" --extra-ldflags="-arch x86_64 -mmacosx-version-min=11.0")
    lipo -create -output "$OUT/ffmpeg-$TARGET" "$ARM" "$X86"
    # Tauri's universal build also looks for each half by its own name.
    cp "$ARM" "$OUT/ffmpeg-aarch64-apple-darwin"
    cp "$X86" "$OUT/ffmpeg-x86_64-apple-darwin"
    ;;
  x86_64-unknown-linux-gnu)
    BIN=$(build linux --extra-ldflags=-static-libgcc)
    cp "$BIN" "$OUT/ffmpeg-$TARGET"
    ;;
  *)
    echo "unknown target: $TARGET" >&2
    exit 1
    ;;
esac

rm -rf "$WORK"
ls -la "$OUT"
