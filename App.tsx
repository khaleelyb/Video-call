import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CallStatus } from './types';
import { PhoneIcon, HangUpIcon, CopyIcon, LinkIcon } from './components/Icons';
import AudioVisualizer from './components/AudioVisualizer';
import type { Socket } from 'socket.io-client';

// This must be replaced with the URL of your deployed signaling server.
const SIGNALING_SERVER_URL = 'https://gemini-voice-chat-signal.glitch.me/';

const STUN_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

// Default room name used when no room ID is provided by the user.
const DEFAULT_ROOM_NAME = 'public-room';

const App: React.FC = () => {
    const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.IDLE);
    const [roomID, setRoomID] = useState<string>('');
    const [inputRoomID, setInputRoomID] = useState<string>('');
    const [otherUserSocketID, setOtherUserSocketID] = useState<string | null>(null);
    const [isInitiator, setIsInitiator] = useState<boolean>(false);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
    const [errorMessage, setErrorMessage] = useState<string>('');
    
    const socket = useRef<Socket | null>(null);
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    const localAudioRef = useRef<HTMLAudioElement>(null);
    const remoteAudioRef = useRef<HTMLAudioElement>(null);

    const cleanup = useCallback(() => {
        console.log('Cleaning up...');
        if (peerConnection.current) {
            peerConnection.current.close();
            peerConnection.current = null;
        }
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            setLocalStream(null);
        }
        setRemoteStream(null);
        if (socket.current) {
            socket.current.disconnect();
            socket.current = null;
        }
    }, [localStream]);

    const initializeSocket = useCallback(() => {
        if (socket.current) return;
        // @ts-ignore - io is loaded from CDN
        socket.current = io(SIGNALING_SERVER_URL);

        socket.current.on('connect', () => {
            console.log('Connected to signaling server');
        });

        socket.current.on('user-joined', (userID: string) => {
            console.log('User joined:', userID);
            setOtherUserSocketID(userID);
            if (isInitiator) {
                createAndSendOffer();
            }
        });

        socket.current.on('signal', async (data: { sender: string; signal: any }) => {
            if (!peerConnection.current) return;
            const { signal } = data;

            if (signal.type === 'offer') {
                console.log('Received offer');
                await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
                const answer = await peerConnection.current.createAnswer();
                await peerConnection.current.setLocalDescription(answer);
                socket.current?.emit('signal', { target: data.sender, signal: answer });
                console.log('Sent answer');
            } else if (signal.type === 'answer') {
                console.log('Received answer');
                await peerConnection.current.setRemoteDescription(new RTCSessionDescription(signal));
            } else if (signal.candidate) {
                console.log('Received ICE candidate');
                try {
                    await peerConnection.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
                } catch (e) {
                    console.error('Error adding received ice candidate', e);
                }
            }
        });
        
        socket.current.on('user-left', () => {
            setErrorMessage('Your friend has left the call.');
            resetState();
        });

    }, [isInitiator]);


    const initializePeerConnection = useCallback(async () => {
        if (!localStream || !socket.current) return;

        peerConnection.current = new RTCPeerConnection(STUN_SERVERS);

        localStream.getTracks().forEach(track => peerConnection.current?.addTrack(track, localStream));

        peerConnection.current.ontrack = (event) => {
            console.log('Remote track received');
            setRemoteStream(event.streams[0]);
            setCallStatus(CallStatus.CONNECTED);
        };

        peerConnection.current.onicecandidate = (event) => {
            if (event.candidate && otherUserSocketID) {
                socket.current?.emit('signal', {
                    target: otherUserSocketID,
                    signal: { candidate: event.candidate },
                });
            }
        };

        peerConnection.current.onconnectionstatechange = () => {
            console.log('Connection state:', peerConnection.current?.connectionState);
             if (peerConnection.current?.connectionState === 'failed' || peerConnection.current?.connectionState === 'disconnected' || peerConnection.current?.connectionState === 'closed') {
                setErrorMessage('Connection lost.');
                resetState();
            }
        };

    }, [localStream, otherUserSocketID]);

    useEffect(() => {
        if (localStream && otherUserSocketID) {
            initializePeerConnection();
        }
    }, [localStream, otherUserSocketID, initializePeerConnection]);


    const createAndSendOffer = async () => {
        if (!peerConnection.current) await initializePeerConnection();
        if (!peerConnection.current || !socket.current || !otherUserSocketID) return;
        
        console.log('Creating offer...');
        setCallStatus(CallStatus.CONNECTING);
        const offer = await peerConnection.current.createOffer();
        await peerConnection.current.setLocalDescription(offer);
        socket.current.emit('signal', { target: otherUserSocketID, signal: offer });
        console.log('Offer sent');
    };

    const getMedia = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setLocalStream(stream);
            return stream;
        } catch (error) {
            console.error('Error accessing microphone:', error);
            setErrorMessage('Microphone access is required to start a call.');
            setCallStatus(CallStatus.ERROR);
            return null;
        }
    };

    const handleCreateRoom = async () => {
        const stream = await getMedia();
        if (!stream) return;
        
        setCallStatus(CallStatus.CREATING_ROOM);
        setIsInitiator(true);
        const newRoomID = Math.random().toString(36).substring(2, 9);
        setRoomID(newRoomID);
        initializeSocket();
        socket.current?.emit('join-call', newRoomID);
        setCallStatus(CallStatus.WAITING);
    };

    // Updated: allow joining without entering a room ID.
    const handleJoinRoom = async () => {
        const roomToJoin = inputRoomID.trim() || DEFAULT_ROOM_NAME;

        const stream = await getMedia();
        if (!stream) return;

        // clear any previous error
        setErrorMessage('');

        setCallStatus(CallStatus.JOINING);
        setIsInitiator(false);
        setRoomID(roomToJoin);
        initializeSocket();
        socket.current?.emit('join-call', roomToJoin);
        setCallStatus(CallStatus.CONNECTING);
    };

    const resetState = useCallback(() => {
        cleanup();
        setCallStatus(CallStatus.IDLE);
        setRoomID('');
        setInputRoomID('');
        setOtherUserSocketID(null);
        setIsInitiator(false);
    }, [cleanup]);

    useEffect(() => {
        if (localStream && localAudioRef.current) {
            localAudioRef.current.srcObject = localStream;
        }
    }, [localStream]);

    useEffect(() => {
        if (remoteStream && remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
        }
    }, [remoteStream]);
    
    const copyToClipboard = () => {
        navigator.clipboard.writeText(roomID);
    };

    const renderIdle = () => (
        <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-xl p-8 space-y-6">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-white">Gemini Voice Chat</h1>
                <p className="text-gray-400 mt-2">Connect with a friend instantly.</p>
            </div>
            
            <button
                onClick={handleCreateRoom}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition-transform transform hover:scale-105"
            >
                <PhoneIcon className="h-6 w-6" />
                <span>Create New Room</span>
            </button>
            
            <div className="relative flex items-center justify-center text-gray-500">
                <span className="absolute left-0 w-full h-px bg-gray-700"></span>
                <span className="relative bg-gray-800 px-4">OR</span>
            </div>

            <div className="space-y-4">
                <div className="relative">
                    <LinkIcon className="h-5 w-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"/>
                     <input
                        type="text"
                        placeholder="Enter Room ID (or press Enter to join default room)"
                        value={inputRoomID}
                        onChange={(e) => setInputRoomID(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleJoinRoom();
                            }
                        }}
                        className="w-full bg-gray-700 text-white placeholder-gray-400 border border-gray-600 rounded-lg py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                <button
                    onClick={handleJoinRoom}
                    className="w-full bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105"
                >
                    Join Room
                </button>
            </div>
            
             {(callStatus === CallStatus.ERROR && errorMessage) && (
                <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-center">
                   {errorMessage}
                </div>
            )}
        </div>
    );

    const renderWaiting = () => (
         <div className="w-full max-w-md bg-gray-800 rounded-2xl shadow-xl p-8 space-y-6 text-center">
            <h2 className="text-2xl font-bold">Your room is ready!</h2>
            <p className="text-gray-400">Share this Room ID with your friend:</p>
            <div className="flex items-center justify-center bg-gray-700 p-4 rounded-lg">
                <span className="text-2xl font-mono text-indigo-400 tracking-widest">{roomID}</span>
                <button onClick={copyToClipboard} className="ml-4 p-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 transition">
                    <CopyIcon className="h-6 w-6 text-white"/>
                </button>
            </div>
            <div className="flex justify-center items-center space-x-2 text-gray-400">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-400"></div>
                <span>Waiting for friend to join...</span>
            </div>
             <button
                onClick={resetState}
                className="w-full mt-4 bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition-transform transform hover:scale-105"
            >
                <HangUpIcon className="h-6 w-6" />
                <span>Cancel</span>
            </button>
         </div>
    );
    
    const renderInCall = () => (
         <div className="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-xl p-8 space-y-8">
            <div className="text-center">
                <h2 className="text-2xl font-bold">
                    {callStatus === CallStatus.CONNECTING ? 'Connecting...' : `In call with friend`}
                </h2>
                <p className="text-gray-400 font-mono text-sm">{otherUserSocketID}</p>
            </div>
            <div className="flex justify-around items-center">
                <div className="flex flex-col items-center space-y-3">
                    <p className="font-semibold text-lg">You</p>
                    <AudioVisualizer stream={localStream} isMuted />
                </div>
                <div className="flex flex-col items-center space-y-3">
                    <p className="font-semibold text-lg">Friend</p>
                    <AudioVisualizer stream={remoteStream} />
                </div>
            </div>
             <button
                onClick={resetState}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center space-x-2 transition-transform transform hover:scale-105"
            >
                <HangUpIcon className="h-6 w-6" />
                <span>Hang Up</span>
            </button>
             {(errorMessage) && (
                <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-center">
                   {errorMessage}
                </div>
            )}
        </div>
    );

    const renderContent = () => {
        switch (callStatus) {
            case CallStatus.IDLE:
            case CallStatus.ERROR:
                return renderIdle();
            case CallStatus.CREATING_ROOM:
            case CallStatus.WAITING:
                return renderWaiting();
            case CallStatus.JOINING:
            case CallStatus.CONNECTING:
            case CallStatus.CONNECTED:
                return renderInCall();
            default:
                return renderIdle();
        }
    };

    return (
        <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 font-sans">
             <audio ref={localAudioRef} autoPlay muted />
             <audio ref={remoteAudioRef} autoPlay />
            {renderContent()}
        </div>
    );
};

export default App;