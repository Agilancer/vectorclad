"""Encodes the soundtrack WAVs to the MP3s the game streams from audio/music/.

    pip install lameenc
    python tools/build_music.py "F:/! THEDEMONMECHANIZEDMACHINEDESTROYER"

The source folder holds the masters as "THEDEMONMECHANIZEDMACHINEDESTROYER - <SONG>.wav"
(16-bit PCM). They stay outside the repo; only the MP3s are committed. js/music.js lists
the output names, so a renamed or added song needs an entry there too.
"""
import re
import sys
import wave
from pathlib import Path

import lameenc

KBPS = 160  # Vectors has to download before the title screen shows, so keep it small
OUT = Path(__file__).resolve().parent.parent / 'audio' / 'music'


def slug(path):
    name = path.stem.split(' - ', 1)[-1]
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def encode(src, dst):
    with wave.open(str(src), 'rb') as w:
        if w.getsampwidth() != 2:
            sys.exit(f'{src.name}: expected 16-bit PCM, got {w.getsampwidth() * 8}-bit')
        enc = lameenc.Encoder()
        enc.set_bit_rate(KBPS)
        enc.set_in_sample_rate(w.getframerate())
        enc.set_channels(w.getnchannels())
        enc.set_quality(2)
        mp3 = enc.encode(w.readframes(w.getnframes())) + enc.flush()
        secs = w.getnframes() / w.getframerate()
    dst.write_bytes(mp3)
    print(f'{dst.name:32} {int(secs // 60)}:{secs % 60:04.1f}  {len(mp3) / 1e6:.1f} MB')


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    wavs = sorted(Path(sys.argv[1]).glob('*.wav'))
    if not wavs:
        sys.exit(f'no .wav files in {sys.argv[1]}')
    OUT.mkdir(parents=True, exist_ok=True)
    for src in wavs:
        encode(src, OUT / f'{slug(src)}.mp3')


if __name__ == '__main__':
    main()
