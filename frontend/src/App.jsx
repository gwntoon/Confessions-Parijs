import { useRef, useState } from 'react';
import axios from 'axios';

function App() {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const autoStopTimeoutRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const messageTimeoutRef = useRef(null);


  const [cameraReady, setCameraReady] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordingSecondsLeft, setRecordingSecondsLeft] = useState(60);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [name, setName] = useState('');

  const showTemporaryMessage = (message) => {
    setFeedbackMessage(message);

    if (messageTimeoutRef.current) {
      clearTimeout(messageTimeoutRef.current);
    }

    messageTimeoutRef.current = setTimeout(() => {
      setFeedbackMessage('');
    }, 5000);
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraReady(false);
  };




  const initCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 720, max: 720 },
          height: { ideal: 1280, max: 1280 },
          frameRate: { ideal: 24, max: 24 },
        },
        audio: true,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        console.log('Video track settings:', videoTrack.getSettings());
      }

      setCameraReady(true);
    } catch (err) {
      console.error('Camera error:', err);
      alert('Camera werkt niet of toestemming is geweigerd');
    }
  };

  const startCountdown = async () => {
    const trimmedName = name.trim();
    const stream = videoRef.current?.srcObject;

    if (!trimmedName) {
      showTemporaryMessage('Vul eerst een naam in');
      return;
    }

    if (!cameraReady) {
      await initCamera();
    }

    const updatedStream = videoRef.current?.srcObject || stream;

    if (!updatedStream) {
      alert('Geen camerastream gevonden');
      return;
    }

    setShowPreview(true);

    let time = 3;
    setCountdown(time);

    const interval = setInterval(() => {
      time -= 1;

      if (time > 0) {
        setCountdown(time);
      } else {
        clearInterval(interval);
        setCountdown(null);
        startRecording();
      }
    }, 1000);
  };

  const formatSeconds = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const startRecording = () => {
    const stream = videoRef.current?.srcObject;

    if (!stream) {
      alert('Geen camerastream gevonden');
      setShowPreview(false);
      return;
    }

    let recorder;

    try {
      const preferredMimeTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm',
      ];

      const selectedMimeType = preferredMimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      const recorderOptions = selectedMimeType
        ? {
            mimeType: selectedMimeType,
            videoBitsPerSecond: 900000,
            audioBitsPerSecond: 64000,
          }
        : {
            videoBitsPerSecond: 900000,
            audioBitsPerSecond: 64000,
          };

      recorder = new MediaRecorder(stream, recorderOptions);
      console.log('Recorder mimeType:', recorder.mimeType);
      console.log('Recorder video bitrate:', recorder.videoBitsPerSecond);
      console.log('Recorder audio bitrate:', recorder.audioBitsPerSecond);
    } catch (err) {
      console.error('MediaRecorder error:', err);
      alert('Opname starten lukt niet op dit apparaat of in deze browser');
      setShowPreview(false);
      stopCamera();
      return;
    }

    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      await handleUpload();
    };

    recorder.start(1000);
    setRecordingSecondsLeft(60);
    setIsRecording(true);

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }

    recordingIntervalRef.current = setInterval(() => {
      setRecordingSecondsLeft((previousSeconds) => {
        if (previousSeconds <= 1) {
          clearInterval(recordingIntervalRef.current);
          return 0;
        }

        return previousSeconds - 1;
      });
    }, 1000);

    autoStopTimeoutRef.current = setTimeout(() => {
      stopRecording();
    }, 60000);
  };

  const stopRecording = () => {
    if (autoStopTimeoutRef.current) {
      clearTimeout(autoStopTimeoutRef.current);
    }
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
    }


    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== 'inactive'
    ) {
      mediaRecorderRef.current.stop();
    }

    setIsRecording(false);
    setShowPreview(false);
    stopCamera();
    setUploadProgress(0);
    setIsUploading(true);
  };

  const handleUpload = async () => {
    if (chunksRef.current.length === 0) {
      console.error('Geen video chunks opgenomen');
      setShowPreview(false);
      stopCamera();
      setIsUploading(false);
      setUploadProgress(0);
      showTemporaryMessage('Upload mislukt');
      return;
    }

    const mimeType = mediaRecorderRef.current?.mimeType || 'video/webm';
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';

    const blob = new Blob(chunksRef.current, { type: mimeType });
    const formData = new FormData();
    formData.append('video', blob, `confession.${extension}`);
    formData.append('name', name.trim());
    setUploadProgress(0);

    try {
      const response = await axios.post('https://confessions-parijs.onrender.com/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total) {
            return;
          }

          const uploadPercentage = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );

          setUploadProgress(Math.min(uploadPercentage, 100));
        },
      });


      console.log('Upload success:', response.data);
      setUploadProgress(100);
      showTemporaryMessage('Uploaden gelukt');
      setName('');
    } catch (err) {
      console.error('Upload error:', err);
      
      if (err.response) {
        console.error('Server response:', err.response.data);
        console.error('Status:', err.response.status);
      }

      showTemporaryMessage('Upload mislukt');
    } finally {
      
      setRecordingSecondsLeft(60);
      chunksRef.current = [];
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div style={styles.container}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={showPreview ? styles.videoVisible : styles.videoHidden}
      />
      {isRecording && <div style={styles.recordingFrameGlow} />}

      {!showPreview && !isRecording && (
        <div style={styles.centerBox}>
          <input
            type="text"
            placeholder="Voer naam in"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
            maxLength={50}
            required
          />

          <button
            style={{
              ...styles.button,
              opacity: name.trim() && !isUploading ? 1 : 0.5,
              cursor: name.trim() && !isUploading ? 'pointer' : 'not-allowed',
            }}
            onClick={startCountdown}
            disabled={!name.trim() || isUploading}
          >
            CONFESS
          </button>

          {isUploading && (
            <div style={styles.uploadingContainerStartScreen}>
              <div style={styles.uploadingBadge}>Uploaden... {uploadProgress}%</div>
              <div style={styles.progressTrack}>
                <div
                  style={{
                    ...styles.progressFill,
                    width: `${uploadProgress}%`,
                  }}
                />
              </div>
            </div>
          )}

          {feedbackMessage && (
            <div style={styles.feedbackMessage}>{feedbackMessage}</div>
          )}
        </div>
      )}

      <div style={styles.overlay}>
        {isRecording && (
          <div style={styles.recordingHeader}>
            <div style={styles.recordingBadgeTop}>
              <div style={styles.recordingDotPulseWrap}>
                <div style={styles.recordingDotPulse} />
                <div style={styles.recordingDot} />
              </div>
              <span>Recording...</span>
            </div>
            <div style={styles.recordingTimerBadge}>
              {formatSeconds(recordingSecondsLeft)} remaining
            </div>
          </div>
        )}

        {countdown !== null && <div style={styles.countdown}>{countdown}</div>}

        {isRecording && (
          <div style={styles.bottomControls}>
            <button style={styles.stopButton} onClick={stopRecording}>
              STOP
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    position: 'relative',
    width: '100vw',
    minHeight: '100vh',
    minHeight: '100dvh',
    background: '#000',
    overflow: 'hidden',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    color: '#fff',
    paddingTop: 'env(safe-area-inset-top)',
    paddingBottom: 'env(safe-area-inset-bottom)',
    boxSizing: 'border-box',
  },
  videoVisible: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scaleX(-1)',
    background: '#000',
  },
  videoHidden: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: 'scaleX(-1)',
    opacity: 0,
    pointerEvents: 'none',
    background: '#000',
  },
  recordingFrameGlow: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    boxShadow: 'inset 0 0 0 3px rgba(255, 43, 43, 0.9), inset 0 0 70px rgba(255, 43, 43, 0.22)',
    zIndex: 2,
  },
  centerBox: {
    zIndex: 4,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    width: '100%',
    maxWidth: '420px',
    padding: 'max(20px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
    boxSizing: 'border-box',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: 3,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    padding: '16px 18px',
    fontSize: 'clamp(16px, 4vw, 18px)',
    borderRadius: '12px',
    border: '1px solid rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    outline: 'none',
    textAlign: 'center',
    boxSizing: 'border-box',
  },
  button: {
    zIndex: 4,
    width: '100%',
    maxWidth: '320px',
    minHeight: '56px',
    padding: '18px 32px',
    fontSize: 'clamp(20px, 5vw, 24px)',
    fontWeight: 'bold',
    background: '#d00000',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
  },
  stopButton: {
    zIndex: 4,
    width: 'min(320px, calc(100vw - 32px))',
    minHeight: '56px',
    padding: '16px 28px',
    fontSize: 'clamp(18px, 4.8vw, 20px)',
    fontWeight: 'bold',
    background: 'rgba(0, 0, 0, 0.75)',
    border: '1px solid #fff',
    borderRadius: '12px',
    color: '#fff',
    cursor: 'pointer',
    pointerEvents: 'auto',
  },
  countdown: {
    fontSize: 'clamp(72px, 24vw, 120px)',
    fontWeight: 'bold',
    textShadow: '0 0 20px rgba(0,0,0,0.8)',
  },
  feedbackMessage: {
    fontSize: '16px',
    color: '#fff',
    opacity: 0.9,
    textAlign: 'center',
    minHeight: '20px',
  },
  recordingHeader: {
    position: 'absolute',
    top: 'max(12px, env(safe-area-inset-top))',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    width: 'calc(100% - 24px)',
    maxWidth: '360px',
  },
  recordingBadgeTop: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px',
    borderRadius: '999px',
    background: 'rgba(0, 0, 0, 0.65)',
    fontSize: 'clamp(16px, 4vw, 18px)',
    fontWeight: 'bold',
  },
  recordingTimerBadge: {
    padding: '8px 14px',
    borderRadius: '999px',
    background: 'rgba(0, 0, 0, 0.65)',
    fontSize: 'clamp(14px, 3.8vw, 16px)',
    fontWeight: 'bold',
  },
  bottomControls: {
    position: 'absolute',
    left: '50%',
    bottom: 'max(12px, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    padding: '0 12px',
    boxSizing: 'border-box',
    pointerEvents: 'none',
  },
  uploadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    maxWidth: '360px',
    padding: '0 20px',
    boxSizing: 'border-box',
  },
  uploadingContainerStartScreen: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    maxWidth: '360px',
    padding: '4px 0 0',
    boxSizing: 'border-box',
  },
  uploadingBadge: {
    padding: '10px 16px',
    borderRadius: '999px',
    background: 'rgba(0, 0, 0, 0.65)',
    fontSize: 'clamp(16px, 4vw, 18px)',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  progressTrack: {
    width: '100%',
    height: '10px',
    borderRadius: '999px',
    background: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: '999px',
    background: '#d00000',
    transition: 'width 0.2s ease',
  },
  recordingDotPulseWrap: {
    position: 'relative',
    width: '14px',
    height: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingDotPulse: {
    position: 'absolute',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    background: 'rgba(255, 0, 0, 0.35)',
    animation: 'recordingPulse 1.6s ease-out infinite',
  },
  recordingDot: {
    position: 'relative',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: '#ff2b2b',
    boxShadow: '0 0 10px rgba(255, 43, 43, 0.65)',
  },
};

const pulseKeyframes = `
  @keyframes recordingPulse {
    0% {
      transform: scale(1);
      opacity: 0.9;
    }
    70% {
      transform: scale(2.2);
      opacity: 0;
    }
    100% {
      transform: scale(2.2);
      opacity: 0;
    }
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('recording-pulse-keyframes')) {
  const styleTag = document.createElement('style');
  styleTag.id = 'recording-pulse-keyframes';
  styleTag.innerHTML = pulseKeyframes;
  document.head.appendChild(styleTag);
}

export default App;