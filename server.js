const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { Readable } = require("stream");
const path = require("path");

const app = express();
const PORT = 5000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

const jobs = {};

const TTS_URL = "http://localhost:5001";

app.post("/api", async (req, res) => {
    const { text, voice, options } = req.body;

    if (!text) return res.status(400).send("Text is required");

    const jobId = uuidv4();
    jobs[jobId] = { status: "processing", mp3Path: null };

    res.status(201).json({
        downloadUrl: `/api/download/${jobId}`
    });

    console.log(`[INFO] Job ${jobId} queued`);

    fetch(`${TTS_URL}/synthesize`, {
        method: "POST",
        headers: { "Content-type": "application/json" },
        body: JSON.stringify({
            jobId,
            text,
            ...(voice ? { voice } : {}),
            ...(options ? { options } : {})
        })
    }).catch((err) => {
        jobs[jobId].status = "failed";
        console.error(`[ERROR] Job ${jobId} failed`, err);
    });
});

app.post("/api/notify-done", (req, res) => {
    const { jobId, status, path, error } = req.body;

    if (!jobId || !jobs[jobId]) return res.status(400).send("Invalid jobId");

    jobs[jobId].status = status;
    if (status === "done") jobs[jobId].mp3Path = path;
    if (status === "failed") jobs[jobId].error = error;

    console.log(`[INFO] Job ${jobId} ${status}` + (error ? ` - ${error}` : ""));

    res.status(200).send();
});

app.get("/api/download/:jobId", async (req, res) => {
    const jobId = req.params.jobId;
    const job = jobs[jobId];

    if (!job) return res.status(404).send("Job not found");
    if (job.status === "processing") return res.status(202).send("Processing, try again later");
    if (job.status === "failed") return res.status(500).send("Job failed");

    try {
        const response = await fetch(`${TTS_URL}/download/${jobId}`);
        if (!response.ok) return res.status(response.status).send(await response.text());

        res.setHeader("Content-Type", "audio/mpeg");

        Readable.fromWeb(response.body).pipe(res);
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