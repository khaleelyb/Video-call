
import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
    stream: MediaStream | null;
    isMuted?: boolean;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ stream, isMuted = false }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameId = useRef<number>();

    useEffect(() => {
        if (!stream || !canvasRef.current) return;

        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const canvas = canvasRef.current;
        const canvasCtx = canvas.getContext('2d');
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!canvasCtx) return;

            animationFrameId.current = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 1.5;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = isMuted ? 2 : (dataArray[i] / 255) * canvas.height;
                
                const r = 45 + (dataArray[i] / 255) * 50;
                const g = 74 + (dataArray[i] / 255) * 100;
                const b = 224 - (dataArray[i] / 255) * 50;

                canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

                x += barWidth + 1;
            }
        };

        draw();

        return () => {
            if (animationFrameId.current) {
                cancelAnimationFrame(animationFrameId.current);
            }
            audioContext.close();
        };
    }, [stream, isMuted]);

    return <canvas ref={canvasRef} width="200" height="80" className="rounded-lg bg-gray-800/50" />;
};

export default AudioVisualizer;
