# Geometer's speech-to-text service (voice notes in, text out). See README.md. NOT built by the deploy bundle: build it once with
#   docker build -t geo-speech:0.1.0 bundle/services/speech
# (the bundle's Compose file names the image by that tag, bundle/lib/server.ts DEFAULT_SPEECH_IMAGE).
#
# Three stages so the final image carries no compiler, no cmake, no git and no pip cache:
#   1. whisper  - builds whisper.cpp's command-line program from one pinned commit
#   2. wheels   - installs the Python packages from requirements.lock, which pins every hash
#   3. final    - python:3.12-slim + ffmpeg + the two products above + our code, running as an unprivileged user
# The model files are NOT in the image (several are gated on Hugging Face); they are mounted at /models (README, "fetch-models").

# python:3.12-slim-bookworm, linux/amd64 + linux/arm64 index, as of 12 Nov 2026
ARG PYTHON_IMAGE=python:3.12-slim-bookworm@sha256:935c3c5b12357a7e10caa9c1e6ca5692344d97cf229832ef584be2cec9fc03df

# ---- 1. whisper.cpp v1.9.5 (MIT), commit d1be6fde11ac6e0407606b4e42fe72d34add8037, 6 Oct 2026 --------------------------------------
FROM ${PYTHON_IMAGE} AS whisper
ARG WHISPER_CPP_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git init -q . \
 && git fetch -q --depth 1 https://github.com/ggml-org/whisper.cpp "${WHISPER_CPP_COMMIT}" \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${WHISPER_CPP_COMMIT}"
# Static, no OpenMP (so the final image needs no extra runtime library), no tests, no server. GGML_NATIVE=OFF so the program runs on any
# machine of the architecture, not only the one that built it; on x86-64 AVX2/FMA/F16C are switched on explicitly (every server we would
# rent has them, and without them Whisper is several times slower).
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    flags="-DGGML_NATIVE=OFF"; \
    if [ "$arch" = "amd64" ]; then flags="$flags -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON"; fi; \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_OPENMP=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF $flags; \
    cmake --build build -j 4 --target whisper-cli; \
    strip build/bin/whisper-cli

# ---- 2. Python packages, hash-checked, wheels only (nothing is compiled) ---------------------------------------------------------
FROM ${PYTHON_IMAGE} AS wheels
COPY requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: --no-deps --prefix /install -r /tmp/requirements.lock

# ---- 3. the image that runs ----------------------------------------------------------------------------------------------------------
FROM ${PYTHON_IMAGE}
# ffmpeg decodes whatever the phone sent. Debian's package version floats inside bookworm's security updates; pinning it exactly would
# stop the image from receiving them (README, "What is pinned").
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin speech
COPY --from=wheels /install /usr/local
COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
WORKDIR /app
COPY geometer_speech /app/geometer_speech
COPY models.lock.json /app/models.lock.json
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app \
    SPEECH_MODELS_DIR=/models SPEECH_PORT=8080 SPEECH_HOST=0.0.0.0
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=4).status == 200 else 1)"]
# `docker run IMAGE python -m geometer_speech.fetch_models ...` runs the operator's download step from the same image.
CMD ["python", "-m", "geometer_speech.server"]
