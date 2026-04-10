const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;
const SERVER_VERSION = 'raw-webm-upload-v4';
const FRONTEND_URL = process.env.FRONTEND_URL;

app.use(cors({
    origin: (origin, callback) => {
        const allowedOrigins = [
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            FRONTEND_URL,
        ].filter(Boolean);

        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
}));

const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Simple uploads index for testing
app.get('/uploads', async (req, res) => {
    try {
        const files = await fs.promises.readdir(uploadsDir);

        const videoFiles = files.filter((file) => {
            const lower = file.toLowerCase();
            return lower.endsWith('.mp4') || lower.endsWith('.webm');
        });

        const filesWithStats = await Promise.all(
            videoFiles.map(async (file) => {
                const absolutePath = path.join(uploadsDir, file);
                const stats = await fs.promises.stat(absolutePath);
                const durationSeconds = await probeVideoDuration(absolutePath);

                return {
                    file,
                    sizeBytes: stats.size,
                    sizeLabel: formatBytes(stats.size),
                    uploadedAt: stats.birthtime,
                    uploadedAtLabel: formatDateTimeAmsterdam(stats.birthtime),
                    durationSeconds,
                    durationLabel: formatDuration(durationSeconds),
                };
            })
        );

        filesWithStats.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

        const html = `
            <!doctype html>
            <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>Uploads</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background: #111;
                        color: #fff;
                        margin: 0;
                        padding: 24px;
                    }
                    h1 {
                        margin-top: 0;
                        margin-bottom: 8px;
                    }
                    p {
                        color: rgba(255,255,255,0.75);
                        margin-top: 0;
                        margin-bottom: 24px;
                    }
                    ul {
                        list-style: none;
                        padding: 0;
                        margin: 0;
                    }
                    li {
                        padding: 14px 0;
                        border-bottom: 1px solid rgba(255,255,255,0.12);
                    }
                    a {
                        color: #9ad1ff;
                        text-decoration: none;
                        word-break: break-word;
                        font-weight: 600;
                    }
                    a:hover {
                        text-decoration: underline;
                    }
                    .meta {
                        margin-top: 6px;
                        font-size: 14px;
                        color: rgba(255,255,255,0.72);
                        line-height: 1.5;
                    }
                    .empty {
                        opacity: 0.75;
                    }
                </style>
            </head>
            <body>
                <h1>Uploads</h1>
                <p>Totaal: ${filesWithStats.length} videobestand(en)</p>
                ${filesWithStats.length
                    ? `<ul>${filesWithStats
                        .map(({ file, sizeLabel, uploadedAtLabel, durationLabel }) => `
                            <li>
                                <a href="/uploads/${encodeURIComponent(file)}" target="_blank" rel="noopener noreferrer">${file}</a>
                                <div class="meta">Geüpload: ${uploadedAtLabel}<br />Duur: ${durationLabel}<br />Bestandsgrootte: ${sizeLabel}</div>
                            </li>
                        `)
                        .join('')}</ul>`
                    : '<p class="empty">No uploads found.</p>'}
            </body>
            </html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Failed to read uploads directory:', error);
        return res.status(500).send('Could not read uploads directory');
    }
});

// Serve uploaded files publicly (for testing)
app.use('/uploads', express.static(uploadsDir));


const sanitizeName = (name = 'unknown') => {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-_]/g, '')
        .slice(0, 50) || 'unknown';
};

const createTimestamp = () => {
    const formatter = new Intl.DateTimeFormat('nl-NL', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });

    const parts = formatter.formatToParts(new Date());
    const get = (type) => parts.find((part) => part.type === type)?.value || '00';

    const date = [get('year'), get('month'), get('day')].join('');
    const time = [get('hour'), get('minute'), get('second')].join('');

    return `${date}_${time}`;
};

const formatBytes = (bytes = 0) => {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(
        Math.floor(Math.log(bytes) / Math.log(1024)),
        units.length - 1
    );

    const value = bytes / Math.pow(1024, unitIndex);
    return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDateTimeAmsterdam = (date) => {
    return new Intl.DateTimeFormat('nl-NL', {
        timeZone: 'Europe/Amsterdam',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).format(date);
};

const formatDuration = (seconds = 0) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return 'Onbekend';
    }

    const totalSeconds = Math.round(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};

const probeVideoDuration = (filePath) => {
    return new Promise((resolve) => {
        execFile(
            'ffprobe',
            [
                '-v',
                'error',
                '-show_entries',
                'format=duration:stream=codec_type,duration:stream_tags=DURATION',
                '-of',
                'json',
                filePath,
            ],
            (error, stdout) => {
                if (error) {
                    console.error('FFprobe duration error:', error.message);
                    resolve(null);
                    return;
                }

                try {
                    const data = JSON.parse(stdout);

                    const formatDuration = Number.parseFloat(data?.format?.duration);
                    if (Number.isFinite(formatDuration) && formatDuration > 0) {
                        resolve(formatDuration);
                        return;
                    }

                    const streamDuration = data?.streams
                        ?.map((stream) => Number.parseFloat(stream.duration))
                        .find((duration) => Number.isFinite(duration) && duration > 0);

                    if (Number.isFinite(streamDuration) && streamDuration > 0) {
                        resolve(streamDuration);
                        return;
                    }

                    const taggedDuration = data?.streams
                        ?.map((stream) => stream?.tags?.DURATION)
                        .find((duration) => typeof duration === 'string' && duration.trim());

                    if (taggedDuration) {
                        const parts = taggedDuration.trim().split(':');

                        if (parts.length === 3) {
                            const hours = Number.parseFloat(parts[0]);
                            const minutes = Number.parseFloat(parts[1]);
                            const seconds = Number.parseFloat(parts[2]);
                            const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;

                            if (Number.isFinite(totalSeconds) && totalSeconds > 0) {
                                resolve(totalSeconds);
                                return;
                            }
                        }
                    }

                    resolve(null);
                } catch (parseError) {
                    console.error('FFprobe duration parse error:', parseError.message);
                    resolve(null);
                }
            }
        );
    });
};

// tijdelijke opslag (.webm)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const tempName = `${Date.now()}${path.extname(file.originalname) || '.webm'}`;
        cb(null, tempName);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: 200 * 1024 * 1024,
    },
});

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        service: 'confession-backend',
        version: SERVER_VERSION,
    });
});

app.post('/upload', upload.single('video'), (req, res) => {
    try {
        console.log(`[${SERVER_VERSION}] Upload route hit`);
        const rawName = req.body.name;

        if (!rawName || !rawName.trim()) {
            if (req.file?.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ error: 'Name is required' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const safeName = sanitizeName(rawName);
        const timestamp = createTimestamp();

        const tempPath = req.file.path;
        const outputFilename = `${safeName}_${timestamp}.webm`;
        const outputPath = path.join(uploadsDir, outputFilename);

        fs.rename(tempPath, outputPath, (renameError) => {
            if (renameError) {
                console.error('File rename error:', renameError);
                return res.status(500).json({
                    error: 'Saving uploaded video failed',
                    details: renameError.message,
                });
            }

            console.log(`[${SERVER_VERSION}] Saved raw WebM upload: ${outputFilename}`);

            return res.json({
                message: 'Upload successful',
                file: outputFilename,
                hasAudio: null,
            });
        });

    } catch (error) {
        console.error('Upload route error:', error);
        res.status(500).json({ error: 'Upload failed on server' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} [${SERVER_VERSION}]`);
    if (FRONTEND_URL) {
        console.log(`Allowed frontend origin: ${FRONTEND_URL}`);
    }
});