const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { Readable } = require("stream");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

const jobs = new Map();

const TTS_URL = "http://localhost:5001";

const JOB_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_JOBS_IN_MEMORY = 5000;

setInterval(() => {
    const now = Date.now();

    for (const [jobId, job] of jobs.entries()) {
        const lastTouched = job.lastAccessAt ?? job.createdAt ?? now;
        if (now - lastTouched > JOB_TTL_MS) {
            jobs.delete(jobId);
        }
    }

    if (jobs.size > MAX_JOBS_IN_MEMORY) {
        const sorted = [...jobs.entries()].sort(
            (a, b) => (a[1].createdAt ?? 0) - (b[1].createdAt ?? 0)
        );
        const toRemove = jobs.size - MAX_JOBS_IN_MEMORY;
        for (let i = 0; i < toRemove; i++) {
            jobs.delete(sorted[i][0]);
        }
    }
}, CLEANUP_INTERVAL_MS).unref();

function setJob(jobId, patch) {
    const prev = jobs.get(jobId);
    if (!prev) return false;
    jobs.set(jobId, { ...prev, ...patch, lastAccessAt: Date.now() });
    return true;
}

app.post("/api", async (req, res) => {
    const { text, voice, options } = req.body;

    if (!text) return res.status(400).send("Text is required");

    const MAX_CHARS = 5000;
    if (text.length > MAX_CHARS)
        return res
            .status(400)
            .send(
                `Text exceeds maximum length of ${MAX_CHARS} characters.\n\nWant no character limits? Self-host this project over at https://github.com/rip-super/tts-service`
            );

    const jobId = uuidv4();

    jobs.set(jobId, {
        status: "processing",
        mp3Path: null,
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
    });

    res.status(201).json({
        downloadUrl: `/api/download/${jobId}`,
    });

    console.log(`[INFO] Job ${jobId} queued`);

    fetch(`${TTS_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-type": "application/json" },
        body: JSON.stringify({
            jobId,
            text,
            ...(voice ? { voice } : {}),
            ...(options ? { options } : {}),
        }),
    }).catch((err) => {
        setJob(jobId, { status: "failed", error: String(err?.message || err) });
        console.error(`[ERROR] Job ${jobId} failed`, err);
    });
});

app.post("/api/notify-done", (req, res) => {
    const { jobId, status, path: mp3Path, error } = req.body;

    if (!jobId || !jobs.has(jobId)) return res.status(400).send("Invalid jobId");

    if (status === "done") {
        setJob(jobId, { status: "done", mp3Path });
    } else if (status === "failed") {
        setJob(jobId, { status: "failed", error });
    } else {
        setJob(jobId, { status });
    }

    console.log(`[INFO] Job ${jobId} ${status}` + (error ? ` - ${error}` : ""));
    res.status(200).send();
});

app.get("/api/download/:jobId", async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs.get(jobId);

    if (!job) return res.status(404).send("Job not found");

    setJob(jobId, {});

    if (job.status === "processing") return res.status(202).send("Processing, try again later");
    if (job.status === "failed") return res.status(500).send("Job failed");

    try {
        const response = await fetch(`${TTS_URL}/download/${jobId}`);
        if (!response.ok) return res.status(response.status).send(await response.text());

        res.setHeader("Content-Type", "audio/mpeg");

        Readable.fromWeb(response.body).pipe(res);

        res.on("finish", () => {
            jobs.delete(jobId);
        });
    } catch (err) {
        console.error(`[ERROR] Failed to download job ${jobId}`, err);
        res.status(500).send("Failed to fetch audio");
    }
});

app.get("/api/voices", (_, res) => {
    res.sendFile(path.join(__dirname, "voices.json"));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
