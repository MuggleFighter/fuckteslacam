import React, { useState, useRef, useEffect } from "react";
import dayjs from "dayjs";
import "./App.css";

interface MimeTypeSupport {
  ext: string;
  opt: MediaRecorderOptions;
}

const App: React.FC = () => {
  // State variables
  const [file, setFile] = useState<File | null>(null);
  const [videoStartTime, setVideoStartTime] = useState<number>(0);
  const [vidName, setVidName] = useState<string>("");
  const [videoURL, setVideoURL] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [fontSize, setFontSize] = useState<number>(16);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string>("");
  const [showError, setShowError] = useState<boolean>(false);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const allChunks = useRef<BlobPart[]>([]);

  // Check supported mime type - 修改编码器优先级和参数
  const checkMimeTypeSupport = (): MimeTypeSupport | null => {

    // MP4 支持通常有限制
    if (MediaRecorder.isTypeSupported("video/mp4")) {
      return {
        ext: "mp4",
        opt: {
          mimeType: "video/mp4; codecs=avc1",
          videoBitsPerSecond: 10000000,
        },
      };
    }
    // WebM 通常兼容性更好，先尝试 WebM
    if (MediaRecorder.isTypeSupported("video/webm; codecs=vp9")) {
      return { 
        ext: "webm", 
        opt: { 
          mimeType: "video/webm; codecs=vp9",
          videoBitsPerSecond: 10000000 
        } 
      };
    }
    if (MediaRecorder.isTypeSupported("video/webm; codecs=vp8")) {
      return { 
        ext: "webm", 
        opt: { 
          mimeType: "video/webm; codecs=vp8",
          videoBitsPerSecond: 10000000
        } 
      };
    }
    if (MediaRecorder.isTypeSupported("video/webm")) {
      return { 
        ext: "webm", 
        opt: { 
          mimeType: "video/webm",
          videoBitsPerSecond: 10000000
        } 
      };
    }

    displayError("当前浏览器不支持视频录制，请使用Chrome浏览器");
    return null;
  };

  // Parse time from filename
  const parseTimeFromFilename = (filename: string): number => {
    try {
      const filenameWithoutExt = filename.substring(
        0,
        filename.lastIndexOf(".")
      );
      const parts = filenameWithoutExt.split("_");

      if (parts.length < 2) {
        throw new Error("文件名格式不正确");
      }

      const datePart = parts[0]; // YYYY-MM-DD
      const timeParts = parts[1].split("-"); // HH-MM-SS-XXX

      if (timeParts.length < 3) {
        throw new Error("文件名中的时间格式不正确");
      }

      const dateStr = `${datePart} ${timeParts[0]}:${timeParts[1]}:${timeParts[2]}`;
      const timestamp = new Date(dateStr).getTime();

      if (isNaN(timestamp)) {
        throw new Error("无法解析文件名中的时间信息");
      }

      return timestamp;
    } catch (error) {
      if (error instanceof Error) {
        displayError(`时间解析错误: ${error.message}`);
      }
      return new Date().getTime(); // 使用当前时间作为后备
    }
  };

  // Display error message
  const displayError = (message: string) => {
    setError(message);
    setShowError(true);

    setTimeout(() => {
      setShowError(false);
    }, 5000);
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const uploadedFile = files[0];

    // Check file type
    if (!uploadedFile.type.startsWith("video/")) {
      displayError("请上传视频文件");
      return;
    }

    const url = URL.createObjectURL(uploadedFile);
    const name = uploadedFile.name.substring(
      0,
      uploadedFile.name.lastIndexOf(".")
    );

    // Parse time info
    const startTime = parseTimeFromFilename(uploadedFile.name);

    setFile(uploadedFile);
    setVidName(name);
    setVideoStartTime(startTime);

    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.load();
    }
  };

  // Draw watermark
  const drawWatermark = (text: string) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Get text size
    ctx.font = `${fontSize}px Arial`;
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const padding = canvas.width / 50;

    const textX = canvas.width - textWidth - padding;
    const textY = canvas.height - padding;

    // 绘制半透明背景，提高文字可见度
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(
      textX - padding/2, 
      textY - fontSize, 
      textWidth + padding, 
      fontSize + padding/2
    );
    
    // 绘制白色文字
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(text, textX, textY);
  };

  // Process video
  const processVideo = async () => {
    if (isProcessing) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video) return;

    // Confirm MIME type support
    const mimeType = checkMimeTypeSupport();
    if (!mimeType) {
      setIsProcessing(false);
      return;
    }

    setIsProcessing(true);
    allChunks.current = [];
    setProgress(0);

    // Initialize recorder
    try {
      // 获取视频的实际帧率，如果无法获取则使用合理的默认值
      const videoFps = 24; // 大多数视频是30fps
      streamRef.current = canvas.captureStream(videoFps);
      recorderRef.current = new MediaRecorder(streamRef.current, mimeType.opt);

        console.log('============', recorderRef.current)

      recorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          allChunks.current.push(e.data);
        }
      };

      // Set up video end event handler
      let videoCompleted = false;

      video.onended = () => {
        videoCompleted = true;
        finishProcessing(mimeType);
      };

      // Start recording
      recorderRef.current.start(1000); // Get a chunk every second

      // Start playing video (muted)
      video.muted = true;
      video.currentTime = 0; // Start from beginning

      await video.play();

      // Update progress periodically
      const updateInterval = setInterval(() => {
        if (video.duration) {
          const currentProgress = (video.currentTime / video.duration) * 100;
          setProgress(currentProgress);
        }

        // If video ended but recording hasn't stopped
        if (videoCompleted) {
          clearInterval(updateInterval);
        }
      }, 200);
      
      // Start render loop
      renderFrames();
    } catch (err) {
      if (err instanceof Error) {
        displayError(`播放失败: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  // Render video frames with watermark
  const renderFrames = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;

    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!video.paused && !video.ended) {
      // Draw video frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Calculate current time
      const currentDate = new Date(videoStartTime + video.currentTime * 1000);
      const currentTime = dayjs(currentDate).format("YYYY-MM-DD HH:mm:ss");

      // Draw watermark
      drawWatermark(currentTime);
    }
    if (!video.paused && !video.ended) {
      requestAnimationFrame(renderFrames);
    }
  };

  // Finish processing
  const finishProcessing = (mimeType: MimeTypeSupport) => {
    const video = videoRef.current;

    try {

      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }

      if (video) {
        video.pause();
      }
      
      
      setProgress(100);

      // Wait for all data to be collected
      setTimeout(() => {
        try {
          if (allChunks.current.length === 0) {
            displayError("没有收集到视频数据");
            setIsProcessing(false);
            return;
          }
          
          // 确保使用正确的MIME类型创建blob
          const blob = new Blob(allChunks.current, {
            type: recorderRef.current?.mimeType || `video/${mimeType.ext}`
          });

          setVideoURL(URL.createObjectURL(blob));
          setIsProcessing(false);
        } catch (err) {
          if (err instanceof Error) {
            displayError(`创建视频失败: ${err.message}`);
          }
          setIsProcessing(false);
        }
      }, 1000);
    } catch (err) {
      if (err instanceof Error) {
        displayError(`处理结束时出错: ${err.message}`);
      }
      setIsProcessing(false);
    }
  };

  // Download processed video
  const downloadVideo = () => {
    if (!videoURL || !vidName) {
      displayError("没有可下载的视频");
      return;
    }

    const mimeType = checkMimeTypeSupport();
    if (!mimeType) return;

    const link = document.createElement("a");
    link.href = videoURL;
    link.download = `${vidName}_watermarked.${mimeType.ext}`;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
    }, 100);
  };

  // 清理函数 - 释放资源
  useEffect(() => {
    return () => {
      // 清理视频URL
      if (videoURL) {
        URL.revokeObjectURL(videoURL);
      }
      
      // 停止所有媒体流
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [videoURL]);

  // Setup canvas when video metadata is loaded
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const handleMetadataLoaded = () => {
      // Set canvas size to match video dimensions
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Set font size based on video width
      const newFontSize = Math.max(16, Math.round(canvas.width / 30));
      setFontSize(newFontSize);

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = `${newFontSize}px Arial`;
        // 使用更好的绘图质量
        ctx.imageSmoothingEnabled = true;
      }
    };

    video.addEventListener("loadedmetadata", handleMetadataLoaded);

    return () => {
      video.removeEventListener("loadedmetadata", handleMetadataLoaded);
    };
  }, [file]);

  return (
    <div className="container">
      <h1>行车记录仪加水印</h1>

      <div className="divider"></div>

      <div className="file-input-container">
        <label htmlFor="file">选择视频：</label>
        <input
          type="file"
          id="file"
          accept="video/*"  // 允许所有视频类型，而不仅仅是mp4
          onChange={handleFileUpload}
          disabled={isProcessing}
        />
      </div>

      {showError && <div className="error-message">{error}</div>}

      <div className="info-panel">
        {isProcessing
          ? "正在处理视频，请勿关闭页面, 处理时长约等于视频时长"
          : `本工具支持流行视频格式添加水印\n命名符合yyyy-MM-dd_hh-mm-ss-name即可\n建议使用Chrome浏览器`}
      </div>

      {(isProcessing || progress > 0) && (
        <div className="progress-container">
          <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          <div className="progress-text">{Math.round(progress)}%</div>
        </div>
      )}

      <div className="button-container">
        {!videoURL && (
          <button onClick={processVideo} disabled={!file || isProcessing}>
            开始处理
          </button>
        )}

        {videoURL && (
          <button onClick={downloadVideo} className="download-button">
            下载视频
          </button>
        )}
      </div>

      <div className="video-container">
        <canvas ref={canvasRef}></canvas>
        <video ref={videoRef} playsInline></video>
      </div>
    </div>
  );
};

export default App;