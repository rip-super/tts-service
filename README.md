# TTS API

[Try it live!](https://tts.sahildash.dev)

---

## Quickstart

Send a basic TTS request with just text:

```bash
curl -X POST "https://tts.sahildash.dev/api" -H "Content-Type: application/json" -d "{\"text\": \"Hello world\"}"
```

The response will be JSON containing a `downloadUrl`. Wait until the job is finished, then download the audio:

```bash
curl "https://tts.sahildash.dev/download/<jobId>" --output output.mp3
```

---

## Installation

1. Install [NodeJS](https://nodejs.org/en) and [Python 3.12+](https://www.python.org/)
2. Clone the repository

```bash
git clone https://github.com/rip-super/tts-service.git
cd tts-service
```

3. Install dependencies:

```bash
npm install
pip install -r requirements.txt
```

4. Install voices:
```bash
cd worker
python download_voices.py
```
*Note: If you have a HuggingFace account, obtain an access token and enter it into the `download_voices.py` script for faster download speeds.*

5. Start the servers:

```bash
# In one terminal
node server.js

# In another terminal
uvicorn worker:app --host 0.0.0.0 --port 5001
```

---

## API Documentation
- API Docs are available [here!](https://tts.sahildash.dev/api/docs)


### Like this project? Feel free to give it a star! Thanks!
