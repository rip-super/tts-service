import json
import os
import shutil
from huggingface_hub import snapshot_download

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

VOICES_DIR = os.path.join(SCRIPT_DIR, "voices")
VOICES_JSON = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "voices.json"))

HF_TOKEN = None # add HuggingFace token for faster downloads

def download_voices():
    if os.path.exists(VOICES_DIR):
        print("Voices directory already exists, skipping download.")
        return

    print("Downloading Piper voices from Hugging Face...")

    while True:
        try:
            snapshot_download(
                repo_id="rhasspy/piper-voices",
                local_dir=VOICES_DIR,
                token=HF_TOKEN,
            )
            print("Download completed successfully.")
            break
        except Exception as e:
            print("Download failed, retrying...")
            print("Error:", e)

def remove_unwanted_files():
    paths_to_remove = [
        os.path.join(VOICES_DIR, "_script"),
        os.path.join(VOICES_DIR, ".gitattributes"),
        os.path.join(VOICES_DIR, "README.md"),
        os.path.join(VOICES_DIR, "voices.json"),
    ]

    for path in paths_to_remove:
        if os.path.isdir(path):
            print("[DELETE]", path)
            shutil.rmtree(path)
        elif os.path.isfile(path):
            print("[DELETE]", path)
            os.remove(path)

def load_allowed_onnx_files():
    with open(VOICES_JSON, "r", encoding="utf-8") as f:
        voices = json.load(f)

    allowed = set()

    for v in voices:
        key = v["key"]
        locale, speaker, quality = key.split("-", 2)
        family = locale.split("_")[0]

        path = os.path.join(
            VOICES_DIR,
            family,
            locale,
            speaker,
            quality,
            f"{key}.onnx",
        )

        allowed.add(os.path.normpath(path))

    return allowed

def find_all_onnx_files():
    found = []
    for root, _, files in os.walk(VOICES_DIR):
        for file in files:
            if file.endswith(".onnx"):
                found.append(os.path.normpath(os.path.join(root, file)))
    return found

def prune_empty_dirs():
    for root, dirs, files in os.walk(VOICES_DIR, topdown=False):
        if not dirs and not files:
            print("[DELETE]", root)
            os.rmdir(root)

def cleanup():
    allowed = load_allowed_onnx_files()
    all_files = find_all_onnx_files()

    missing = allowed - set(all_files)
    if missing:
        print("\nMissing allowed models:")
        for m in sorted(missing):
            print("  ", m)

    to_delete = [f for f in all_files if f not in allowed]

    print()
    print(f"voices.json:    {VOICES_JSON}")
    print(f"Voices dir:     {VOICES_DIR}\n")

    print(f"Allowed models: {len(allowed)}")
    print(f"Found models:   {len(all_files)}")
    print(f"Will delete:    {len(to_delete)}\n")

    for f in to_delete:
        print("[DELETE]", f)
        os.remove(f)

    prune_empty_dirs()

if __name__ == "__main__":
    download_voices()
    cleanup()
    remove_unwanted_files()
    print("Voices successfully download!")
