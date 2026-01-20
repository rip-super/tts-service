import os
import tempfile
import uuid
import threading
from queue import Queue
import requests
import json
import subprocess
import wave
import numpy as np
import soundfile as sf
import imageio_ffmpeg as ffmpeg
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from concurrent.futures import ThreadPoolExecutor
from piper import PiperVoice, SynthesisConfig

MAX_CONCURRENT_JOBS = 3
MAX_CHARS = 3000
SAMPLE_RATE = 24000
DEFAULT_VOICE_KEY = "en_US-lessac-high"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
VOICES_DIR = os.path.join(SCRIPT_DIR, "voices")
VOICES_JSON = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "voices.json"))

with open(VOICES_JSON, "r") as f:
    voices_list = json.load(f)

VOICE_MAP = {}
for v in voices_list:
    key = v["key"]
    locale, speaker, quality = key.split("-", 2)
    language = locale.split("_")[0]

    VOICE_MAP[key] = os.path.join(
        VOICES_DIR,
        language,
        locale,
        speaker,
        quality,
        f"{key}.onnx"
    )

app = FastAPI()
jobs = {}
job_queue = Queue()

class TTSJob(BaseModel):
    jobId: str
    text: str
    voice: str | None = None
    options: dict | None = None

def chunk_text(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    words = text.split()
    chunks = []
    current = ""

    for word in words:
        if len(current) + len(word) + 1 <= max_chars:
            current += (" " if current else "") + word
        else:
            chunks.append(current)
            current = word

    if current:
        chunks.append(current)

    return chunks

def synthesize_chunk(voice_obj: PiperVoice, chunk: str, options: dict | None = None) -> np.ndarray:
    syn_config = None
    if options:
        syn_config = SynthesisConfig(
            volume=options.get("volume", 1.0),
            length_scale=options.get("speed", 1.0),
            noise_scale=options.get("audio_variation", 1.0),
            noise_w_scale=options.get("speaking_variation", 1.0),
            normalize_audio=options.get("normalize_audio", True)
        )

    tmp_wav_file = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4().hex}.wav")
    with wave.open(tmp_wav_file, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)

        if syn_config: voice_obj.synthesize_wav(chunk, wav_file, syn_config=syn_config)
        else: voice_obj.synthesize_wav(chunk, wav_file)

    audio, _ = sf.read(tmp_wav_file)
    os.remove(tmp_wav_file)
    return audio

def run_tts(jobId: str, text: str, voice_key: str | None, options: dict | None = None):
    voice_key = voice_key or DEFAULT_VOICE_KEY

    if voice_key not in VOICE_MAP:
        raise ValueError(f"Voice '{voice_key}' not found!")

    voice_path = VOICE_MAP[voice_key]
    voice_obj = PiperVoice.load(voice_path)

    chunks = chunk_text(text)

    def tts_chunk(chunk_text):
        return synthesize_chunk(voice_obj, chunk_text, options)

    all_audio = []
    with ThreadPoolExecutor(max_workers=min(len(chunks), 4)) as executor:
        futures = [executor.submit(tts_chunk, c) for c in chunks]
        for i, future in enumerate(futures):
            try:
                all_audio.append(future.result())
            except Exception as e:
                raise RuntimeError(f"Chunk {i+1} failed: {e}") from e

    final_audio = np.concatenate(all_audio)

    tmp_wav = os.path.join(tempfile.gettempdir(), f"tts_{jobId}_{uuid.uuid4().hex}.wav")
    tmp_mp3 = os.path.join(tempfile.gettempdir(), f"tts_{jobId}_{uuid.uuid4().hex}.mp3")

    sf.write(tmp_wav, final_audio, SAMPLE_RATE)

    ffmpeg_path = ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [ffmpeg_path, "-y", "-i", tmp_wav, "-codec:a", "libmp3lame", "-qscale:a", "2", tmp_mp3],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    os.remove(tmp_wav)
    return tmp_mp3

def worker_loop():
    while True:
        jobId, text, voice_key, options = job_queue.get()
        notify_payload = {"jobId": jobId}

        try:
            jobs[jobId]["status"] = "processing"
            path = run_tts(jobId, text, voice_key, options)
            jobs[jobId]["status"] = "done"
            jobs[jobId]["path"] = path
            notify_payload.update({"status": "done", "path": path})

        except Exception as e:
            jobs[jobId]["status"] = "failed"
            jobs[jobId]["error"] = str(e)
            print(f"[ERROR] Job {jobId}: Failed - {e}")
            notify_payload.update({"status": "failed", "error": str(e)})

        finally:
            try:
                requests.post("http://localhost:5000/api/notify-done", json=notify_payload)
            except Exception as e:
                print(f"[WARN] Job {jobId}: Failed to notify Express server: {e}")

            job_queue.task_done()

for _ in range(MAX_CONCURRENT_JOBS):
    threading.Thread(target=worker_loop, daemon=True).start()

@app.post("/synthesize")
def synthesize(job: TTSJob):
    if job.jobId in jobs:
        raise HTTPException(status_code=400, detail="Duplicate jobId")
    
    jobs[job.jobId] = {"status": "queued"}
    job_queue.put((job.jobId, job.text, job.voice, job.options))

    return {"jobId": job.jobId, "status": "queued"}

@app.get("/download/{jobId}")
def download(jobId: str):
    job = jobs.get(jobId)

    if not job: raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] in ["queued", "processing"]: raise HTTPException(status_code=202, detail=job["status"])
    if job["status"] == "failed": raise HTTPException(status_code=500, detail=job.get("error", "Job failed"))

    path = job.get("path")
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(path, media_type="audio/mpeg", filename=f"{jobId}.mp3")