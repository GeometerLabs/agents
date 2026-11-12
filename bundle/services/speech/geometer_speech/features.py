"""Log-mel features for IndicConformer, in plain numpy (no torch).

AI4Bharat ships the model's front end as a TorchScript file; loading it would need PyTorch (hundreds of MB) in a service that
is meant to run on onnxruntime alone. This reimplements NeMo's standard `AudioToMelSpectrogramPreprocessor` settings, which
the Conformer family is trained with: 16 kHz, 25 ms Hann window, 10 ms hop, 512-point FFT, 80 Slaney mel bands, pre-emphasis 0.97,
natural log with a 2^-24 floor, then each band normalised to zero mean and unit variance over the note.
It was written from the published NeMo defaults and has NOT been compared with the TorchScript front end on real files:
see Deferred.md "IndicConformer front end unchecked" for the check that closes that.
"""
from __future__ import annotations

import numpy as np

SAMPLE_RATE = 16_000
N_FFT = 512
WIN_LENGTH = 400
HOP = 160
N_MELS = 80
PREEMPH = 0.97
LOG_FLOOR = 2.0 ** -24


def _hz_to_mel(f: np.ndarray) -> np.ndarray:
    # Slaney scale (librosa's default, NeMo's too): linear below 1 kHz, logarithmic above.
    f = np.asarray(f, dtype=np.float64)
    mel = f / (200.0 / 3.0)
    log_region = f >= 1000.0
    mel = np.where(log_region, 15.0 + np.log(np.maximum(f, 1e-9) / 1000.0) / (np.log(6.4) / 27.0), mel)
    return mel


def _mel_to_hz(m: np.ndarray) -> np.ndarray:
    m = np.asarray(m, dtype=np.float64)
    hz = m * (200.0 / 3.0)
    log_region = m >= 15.0
    return np.where(log_region, 1000.0 * np.exp((np.log(6.4) / 27.0) * (m - 15.0)), hz)


def mel_filterbank(n_mels: int = N_MELS, n_fft: int = N_FFT, sr: int = SAMPLE_RATE) -> np.ndarray:
    """[n_mels, n_fft/2+1] triangular filters with Slaney area normalisation."""
    fft_freqs = np.linspace(0.0, sr / 2.0, n_fft // 2 + 1)
    mel_pts = np.linspace(_hz_to_mel(np.array(0.0)), _hz_to_mel(np.array(sr / 2.0)), n_mels + 2)
    hz_pts = _mel_to_hz(mel_pts)
    fb = np.zeros((n_mels, fft_freqs.size))
    for i in range(n_mels):
        lo, mid, hi = hz_pts[i], hz_pts[i + 1], hz_pts[i + 2]
        up = (fft_freqs - lo) / max(mid - lo, 1e-9)
        down = (hi - fft_freqs) / max(hi - mid, 1e-9)
        fb[i] = np.maximum(0.0, np.minimum(up, down))
        fb[i] *= 2.0 / (hi - lo)  # Slaney normalisation: equal energy per band regardless of width
    return fb.astype(np.float32)


_FB = mel_filterbank()
# NeMo uses a non-periodic Hann window of 400 samples, centred inside the 512-point frame.
_WINDOW = np.zeros(N_FFT, dtype=np.float32)
_pad = (N_FFT - WIN_LENGTH) // 2
_WINDOW[_pad:_pad + WIN_LENGTH] = np.hanning(WIN_LENGTH).astype(np.float32)


def log_mel(samples: np.ndarray) -> np.ndarray:
    """Return features shaped [1, 80, frames] (float32), ready for the encoder's `audio_signal` input."""
    x = np.asarray(samples, dtype=np.float32)
    x = np.concatenate([x[:1], x[1:] - PREEMPH * x[:-1]]) if x.size else x
    # center=True with zero padding, as NeMo's STFT does
    x = np.pad(x, (N_FFT // 2, N_FFT // 2))
    frames = 1 + (x.size - N_FFT) // HOP
    if frames < 1:
        raise ValueError("audio too short for features")
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(frames)[:, None]
    spec = np.fft.rfft(x[idx] * _WINDOW, n=N_FFT, axis=1)
    power = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)
    mel = np.log(power @ _FB.T + LOG_FLOOR)  # [frames, 80]
    valid = max(2, samples.size // HOP)  # NeMo drops the padded tail when normalising
    seen = mel[:valid]
    mean = seen.mean(axis=0)
    std = seen.std(axis=0, ddof=1)
    mel = (mel - mean) / (std + 1e-5)
    return mel.T[None, :, :].astype(np.float32)
