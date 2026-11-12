# Geometer speech service (voice notes in, text out)

A small service that turns a customer's WhatsApp voice note into text. Hindi, Malayalam and Kannada go to AI4Bharat's IndicConformer; English goes to Whisper. It listens only: replies to customers are text (owner's decision, 12 Nov 2026), so there is no speech output. It runs on CPU, keeps nothing (audio is held for the length of one request and deleted), and ships with the open deploy bundle so a builder can run it too. Partners' shops use the one on Geometer's server.

It is **off** unless the server turns it on, and it has no model files until the operator downloads them (see "What the operator does").

## What it answers

| Route | What it does |
|---|---|
| `POST /v1/transcribe` | The route the voice-notes adapter calls (`modules/voice/geometer.ts`). Multipart form: part `file` = the voice note as it came (Ogg Opus, AMR, MP3, M4A, WAV and more), optional part `language` = `hi`, `ml`, `kn` or `en`. |
| `POST /stt` | The same, and it also takes the raw audio as the body (`Content-Type: audio/...`) with `?language=hi`. |
| `GET /healthz` | 200 when at least one model is loaded, else 503; says which models are loaded. No token needed. |
| `POST /v1/speak` | 501, "this service only listens". |

Answer: `{"text": "...", "language": "hi", "seconds": 7.4, "model": "...", "confidence": 0.91}`. `seconds` is the length of the audio, `model` names what heard it, `confidence` (0 to 1) is left out when the engine cannot say. Errors are `{"error": "<a sentence a person can read>"}` with a status: 400 bad request or unknown language, 401 wrong token, 411 no length, 413 over 5 MB or over 30 seconds, 415 unusable content type, 422 not audio, 503 busy or a model not installed (with `Retry-After` when busy), 501 for `/v1/speak`.

**Limits (owner, 12 Nov):** 30 seconds (250 ms of grace for codec padding) and 5 MB. A note over the size is refused on its header, before the body is read. Audio is decoded with ffmpeg to 16 kHz mono, stopped two seconds past the limit so a long file cannot hold the box.

**Token:** on the server's private network the speech Guard needs no token. If the service is somewhere else, give it `SPEECH_TOKEN_FILE`; it then refuses to start without one (`SPEECH_REQUIRE_TOKEN=1`) and wants the same value in the `Authorization` header (the speech Guard sends the file's contents; `Bearer <token>` is accepted too).

## Which model hears a note

- A language hint (`hi`, `ml`, `kn`, `en`; `hi-IN` style is fine) goes straight to that language's engine.
- No hint (the adapter sends none today): Whisper **tiny** is asked "what language is this" (about a second, to be measured). If it says English with probability 0.6 or more (`SPEECH_EN_MIN_PROB`), Whisper **small.en** writes it. Anything else goes to IndicConformer, which encodes the note once and then scores Hindi, Malayalam and Kannada against each other (the language whose pieces hold the most probability on the audio wins; Whisper's guess among Indic languages is not used). This is a cheap first version; the bake-off's `--detect` mode measures how often it is right.
- One model run at a time (a 4 vCPU box gains nothing from two); up to three more notes wait, up to 15 s, then "busy, try again".

## The models

| Model | Used for | Licence | Where |
|---|---|---|---|
| IndicConformer 600M multilingual, AI4Bharat. CTC path of the ONNX files (fp32, about 2.5 GB) | Hindi, Malayalam, Kannada | MIT (as shown on its Hugging Face page); **gated**: download needs an account that has accepted its terms | https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual |
| Whisper small.en, 5-bit ggml build (190 MB) | English | MIT (OpenAI's weights; the ggml conversion repo is tagged MIT) | https://github.com/openai/whisper , https://huggingface.co/ggerganov/whisper.cpp |
| Whisper tiny (multilingual), 5-bit ggml build (32 MB) | the language guess only | MIT | same |
| whisper.cpp v1.9.5 (program, built into the image) | runs the two Whisper files | MIT | https://github.com/ggml-org/whisper.cpp |
| onnxruntime 1.31.1 | runs IndicConformer on CPU | MIT | https://github.com/microsoft/onnxruntime |
| numpy 2.5.3 | audio features | BSD-3-Clause | https://numpy.org |
| ffmpeg (Debian's package) | decoding audio | GPL/LGPL components; run as a separate program, not linked. If you ever publish the image itself, publish Debian's source offer with it | https://ffmpeg.org |

Read the licence text on each model's own page when you accept it; this table is what the pages said on 12 Nov 2026, not legal advice. The research behind the choice (accuracy figures, what was ruled out, the weak spots) is in the owner's folder as `open-speech-research.md`.

**Pinned revisions** (`models.lock.json`, made 12 Nov 2026 from the Hub's file listing at these commits):

- `ai4bharat/indic-conformer-600m-multilingual` at `2a77d305038dfc502fd9464e7d028b90381976cb` (371 files under `assets/` plus the model card: the CTC path only, no RNNT, no joint networks)
- `ggerganov/whisper.cpp` at `5359861c739e955e79d9a303bcbc70fb988958b1` (`ggml-small.en-q5_1.bin` sha256 `bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30`; `ggml-tiny-q5_1.bin` sha256 `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7`)

## What the operator does

1. **Accept the licence.** Log in to Hugging Face and open https://huggingface.co/ai4bharat/indic-conformer-600m-multilingual ; read the terms and accept them. Make a read-only access token (Settings, Access Tokens) and save it in a file only you can read (`chmod 600`).
2. **Build the image once** (needs Docker; a few minutes, it compiles whisper.cpp): `docker build -t geo-speech:0.1.0 bundle/services/speech`
3. **Download the models** (about 2.7 GB) into the folder the server will mount; this is the one step that talks to Hugging Face, and only you run it:

   ```
   mkdir -p <server folder>/speech-models
   docker run --rm -v <server folder>/speech-models:/models --user "$(id -u):$(id -g)" \
     -v /path/to/hf-token:/run/hf-token:ro geo-speech:0.1.0 \
     python -m geometer_speech.fetch_models --models-dir /models --token-file /run/hf-token
   ```

   (Without Docker: `python3 -m geometer_speech.fetch_models --models-dir DIR --token-file FILE` from `bundle/services/speech`; it needs only Python 3.) Every file is checked against the pinned commit and its sha256 or git id; a file that fails is deleted and the run stops. `--check` re-verifies what is on disk without any network; `--only whisper-english` fetches just the English files. The token goes to huggingface.co only (it is dropped when a download is redirected to the storage host) and is never printed or kept.
4. **Turn speech on** in the server's `geometer.json`: `"speech": { "enabled": true }` (optional `"image"` and `"modelsDir"`). The next `deploy` adds the `geometer-speech` container on its own internal `speech` network (no route out, no published port, read-only root, models mounted read-only, 6 GB memory cap). The speech Guard is the only thing meant to call it (the voice-notes branch places the Guard; see `bundle/Deferred.md`).
5. Check: `docker compose ... ps` shows it healthy; `/healthz` lists which models loaded. If a model file is missing the service still starts with the others and answers a plain 503 naming the missing step to requests that need it.
6. **Before any shop uses it, run the bake-off** (next section).

A machine for a shop-sized load: 4 vCPU, 8 GB. The Indic model holds about 3 GB when loaded. Speed is not measured yet (`bundle/Deferred.md`).

## The bake-off: score it on real notes first

Collect 20-30 real notes per language and have a native speaker write what was said:

```
notes/
  hi/  note1.ogg  note1.txt  note2.ogg  note2.txt ...
  ml/  ...
  kn/  ...
  en/  ... (or a transcripts.tsv per folder: "note1.ogg<TAB>what was said")
```

With the service running (token file only if it has one):

```
python3 -m geometer_speech.bakeoff notes/ --url http://127.0.0.1:8080 [--token-file FILE] [--digits] [--json result.json]
python3 -m geometer_speech.bakeoff notes/ --detect      # send no language hint: also reports how often the service found the language
```

It posts each note exactly as the adapter does and prints, per language: notes scored and failed, **WER** (word error rate), **CER** (character error rate), **akshara error** (errors per visible letter unit, a consonant with its vowel signs counting as one) and the time per second of audio (`sec/sec`; below 1 is faster than the note is long), plus the five worst notes with what was said and what was heard. For Hindi, Malayalam and Kannada read WER and the other two together: these languages join and inflect words, so a single wrong ending makes a whole word wrong while the sound is nearly right. Text is compared after Unicode normalisation, with punctuation (including the danda) and zero-width joiners removed and Latin letters lower-cased; `--digits` treats Indic digits and 0-9 as the same. WER and CER say how close the words are; "would the shop's order still be right" is a separate yes/no the owner judges on the worst notes.

## Run it by hand, and the tests

```
python3 -m geometer_speech.server          # from bundle/services/speech; SPEECH_MODELS_DIR=... (needs the pinned packages and whisper-cli)
python3 -m unittest discover -s . -t . -p "test_*.py"      # no models needed: ffmpeg and numpy only
```

The tests cover request validation, the token, the size and 30-second limits, language routing, the ffmpeg decode of a generated tone (WAV and Ogg Opus), the Whisper output parsing, IndicConformer's CTC decode on made-up tensors, the multipart reader, the bake-off's scoring and the model pins. The model calls sit behind the small interfaces in `geometer_speech/engines.py` and run with fakes in the tests.

## What is pinned, and what is not

- **Python packages:** `requirements.lock`, five packages, every wheel's sha256, installed with `pip install --require-hashes --only-binary=:all:`. All versions are more than two weeks old (numpy 2.5.3 of 6 Sep, onnxruntime 1.31.1 of 26 Oct, flatbuffers 25.12.19, packaging 26.3, protobuf 7.36.2). The server itself uses only the standard library (no web framework: two routes and a body cap do not justify about fifteen extra packages in a service that handles customers' voice notes).
- **Base image:** `python:3.12-slim-bookworm` by digest. **whisper.cpp:** one commit. **Models:** one commit each.
- **Not pinned:** Debian's ffmpeg version (it floats with bookworm's updates so security fixes arrive).
- The image has no compiler, cmake, git or pip cache; it runs as user 10001.

## Known gaps

Unmeasured or unchecked items, each with a trigger and what "done" means, are in `bundle/Deferred.md` under "Speech-to-text service (12 Nov 2026)": speed on a real 4 vCPU box, Malayalam accuracy, code-mixed speech, the IndicConformer front end (written without the gated files), the language guess, int8, the unbuilt image, the unplaced speech Guard, and the two route names.
