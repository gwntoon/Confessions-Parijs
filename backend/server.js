const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;
const SERVER_VERSION = 'compress-720p-crf23-v1';
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

const sanitizeName = (name = 'unknown') => {
    return name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-_]/g, '')
        .slice(0, 50) || 'unknown';
};

const createTimestamp = () => {
    const now = new Date();

    const date = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('');

    const time = [
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join('');

    return `${date}_${time}`;
};

const probeStreams = (filePath) => {
    return new Promise((resolve, reject) => {
        execFile(
            'ffprobe',
            [
                '-v',
                'error',
                '-show_streams',
                '-show_format',
                '-print_format',
                'json',
                filePath,
            ],
            (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                    return;
                }

                try {
                    resolve(JSON.parse(stdout));
                } catch (parseError) {
                    reject(parseError);
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
        const outputFilename = `${safeName}_${timestamp}.mp4`;
        const outputPath = path.join(uploadsDir, outputFilename);

        probeStreams(tempPath)
            .then((probeData) => {
                console.log('FFprobe input data:', JSON.stringify(probeData, null, 2));
                console.log(`[${SERVER_VERSION}] Using compressed 720p CRF 23 FFmpeg conversion settings`);

                const hasVideo = probeData.streams?.some(
                    (stream) => stream.codec_type === 'video'
                );
                const hasAudio = probeData.streams?.some(
                    (stream) => stream.codec_type === 'audio'
                );

                if (!hasVideo) {
                    throw new Error('Uploaded file does not contain a video stream');
                }

                const ffmpegArgs = [
                    '-y',
                    '-i',
                    tempPath,
                    '-map',
                    '0:v:0',
                    '-c:v',
                    'libx264',
                    '-preset',
                    'veryfast',
                    '-crf',
                    '23',
                    '-vf',
                    'scale=-2:720:force_original_aspect_ratio=decrease',
                    '-pix_fmt',
                    'yuv420p',
                ];

                if (hasAudio) {
                    ffmpegArgs.push(
                        '-map',
                        '0:a:0',
                        '-c:a',
                        'aac_at',
                        '-b:a',
                        '128k',
                        '-ac',
                        '1',
                        '-ar',
                        '48000'
                    );
                }

                ffmpegArgs.push('-movflags', '+faststart', outputPath);

                console.log('Running FFmpeg args:', ffmpegArgs);

                execFile('ffmpeg', ffmpegArgs, (error, stdout, stderr) => {
                    console.log('FFmpeg stdout:', stdout);
                    console.log('FFmpeg stderr:', stderr);

                    if (error) {
                        console.error('FFmpeg error:', error);
                        return res.status(500).json({
                            error: 'Video conversion failed',
                            details: stderr,
                        });
                    }

                    probeStreams(outputPath)
                        .then((convertedProbeData) => {
                            console.log(
                                'FFprobe output data:',
                                JSON.stringify(convertedProbeData, null, 2)
                            );
                            const audioStream = convertedProbeData.streams?.find(
                                (stream) => stream.codec_type === 'audio'
                            );
                            console.log('Converted audio stream:', audioStream);

                            if (fs.existsSync(tempPath)) {
                                fs.unlinkSync(tempPath);
                            }

                            console.log('Converted to compressed 720p MP4:', outputFilename);

                            res.json({
                                message: 'Upload + compression successful',
                                file: outputFilename,
                                hasAudio: convertedProbeData.streams?.some(
                                    (stream) => stream.codec_type === 'audio'
                                ) || false,
                            });
                        })
                        .catch((probeError) => {
                            console.error('FFprobe output error:', probeError);
                            return res.status(500).json({
                                error: 'Converted video probing failed',
                                details: probeError.message,
                            });
                        });
                });
            })
            .catch((probeError) => {
                console.error('FFprobe input error:', probeError);
                return res.status(500).json({
                    error: 'Uploaded video probing failed',
                    details: probeError.message,
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