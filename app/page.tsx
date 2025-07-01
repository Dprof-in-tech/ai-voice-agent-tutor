'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Mic, StopCircle, Play, Speaker, Loader2, MessageSquareText, Lightbulb, User, AlertCircle, Volume2 } from 'lucide-react';

interface AiResponse {
  text: string;
  audioUrl: string;
  hasAudio: boolean;
}

export default function AIStudyBuddy() {
  const [topic, setTopic] = useState<string>('');
  const [userExplanation, setUserExplanation] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<AiResponse | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [playbackAudio, setPlaybackAudio] = useState<HTMLAudioElement | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isUsingSpeechSynthesis, setIsUsingSpeechSynthesis] = useState<boolean>(false);
  const [speechSynthesis, setSpeechSynthesis] = useState<SpeechSynthesisUtterance | null>(null);

  const BACKEND_URL = '';

  useEffect(() => {
    return () => {
      // Cleanup on component unmount
      if (playbackAudio) {
        playbackAudio.pause();
        playbackAudio.src = '';
      }
      // Stop any browser TTS
      if (speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [playbackAudio, speechSynthesis]);

  // Load voices for speech synthesis
  useEffect(() => {
    if ('speechSynthesis' in window) {
      // Load voices
      const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        console.log('Available voices:', voices.length);
      };
      
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }
  }, []);

  // Cleanup previous audio when starting new operations
  const cleanupPreviousAudio = () => {
    if (playbackAudio) {
      playbackAudio.pause();
      playbackAudio.currentTime = 0;
      setPlaybackAudio(null);
    }
    // Also stop any browser TTS
    if (speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeechSynthesis(null);
      setIsUsingSpeechSynthesis(false);
    }
  };

  // Browser TTS functions
  const speakTextWithBrowserTTS = (text: string) => {
    if (!('speechSynthesis' in window)) {
      setWarning('Browser text-to-speech not supported in this browser.');
      return;
    }

    // Stop any existing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure voice settings
    utterance.rate = 0.9; // Slightly slower for better comprehension
    utterance.pitch = 1;
    utterance.volume = 0.8;

    // Try to use a good quality voice
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(voice => 
      voice.lang.includes('en') && (
        voice.name.includes('Google') || 
        voice.name.includes('Microsoft') ||
        voice.name.includes('Alex') ||
        voice.name.includes('Samantha')
      )
    );
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
      setIsUsingSpeechSynthesis(true);
      setIsProcessing(true);
      console.log('Browser TTS started');
    };

    utterance.onend = () => {
      setIsUsingSpeechSynthesis(false);
      setIsProcessing(false);
      setSpeechSynthesis(null);
      console.log('Browser TTS finished');
    };

    utterance.onerror = (event) => {
      setIsUsingSpeechSynthesis(false);
      setIsProcessing(false);
      setSpeechSynthesis(null);
      console.error('Browser TTS error:', event);
      setWarning('Browser text-to-speech encountered an error.');
    };

    setSpeechSynthesis(utterance);
    window.speechSynthesis.speak(utterance);
  };

  const stopBrowserTTS = () => {
    if (speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeechSynthesis(null);
      setIsUsingSpeechSynthesis(false);
      setIsProcessing(false);
    }
  };

  const testBackendConnection = async (retries = 2) => {
    for (let i = 0; i <= retries; i++) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/test`, {
          method: 'GET',
          headers: {
            'Connection': 'keep-alive',
          },
          keepalive: true
        });
        if (!response.ok) {
          throw new Error('Backend not responding');
        }
        const data = await response.json();
        console.log('Backend status:', data);
        return true;
      } catch (err) {
        console.error(`Backend connection attempt ${i + 1} failed:`, err);
        if (i === retries) {
          setError('Cannot connect to backend. Make sure Flask server is running and try refreshing the page.');
          return false;
        }
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return false;
  };

  const safeDecodeHeader = (headerValue: string): string => {
    if (headerValue.startsWith("base64:")) {
      try {
        const b64Data = headerValue.slice(7); // Remove "base64:" prefix
        return atob(b64Data);
      } catch (e) {
        console.error('Failed to decode base64 header:', e);
        return 'Error decoding response text';
      }
    }
    return headerValue;
  };

  const startRecording = async () => {
    setAiResponse(null);
    setUserExplanation('');
    setRecordedAudioBlob(null);
    setError(null);
    setWarning(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      setMediaRecorder(recorder);

      recorder.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        setRecordedAudioBlob(audioBlob);
        audioChunks.current = [];
        stream.getTracks().forEach(track => track.stop());

        await transcribeAudio(audioBlob);
      };

      recorder.start();
      setIsRecording(true);
      console.log('Recording started...');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Could not start microphone. Please ensure permissions are granted.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      setIsRecording(false);
      setIsProcessing(true);
      console.log('Recording stopped...');
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setError(null);
    
    // Test backend connection first
    const isConnected = await testBackendConnection();
    if (!isConnected) {
      setIsProcessing(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio_file', audioBlob, 'recording.webm');

      const response = await fetch(`${BACKEND_URL}/api/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to transcribe audio.');
      }

      const data = await response.json();
      setUserExplanation(data.transcript);
      console.log('Transcription:', data.transcript);

      if (topic && data.transcript) {
        await getExplanationOrFeedback(topic, data.transcript);
      } else {
        setIsProcessing(false);
      }

    } catch (err: any) {
      console.error('Transcription error:', err);
      setError(err.message || 'Error transcribing audio.');
      setIsProcessing(false);
    }
  };

  const getExplanationOrFeedback = async (currentTopic: string, userText: string = '') => {
    setIsProcessing(true);
    setError(null);
    setWarning(null);
    setAiResponse(null);
    cleanupPreviousAudio(); // Stop any playing audio

    // Test backend connection first
    const isConnected = await testBackendConnection();
    if (!isConnected) {
      setIsProcessing(false);
      return;
    }

    try {
      const requestBody = {
        topic: currentTopic,
        user_explanation: userText,
      };

      console.log('Sending request:', requestBody);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // Increased to 2 minute timeout

      const response = await fetch(`${BACKEND_URL}/api/explain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connection': 'keep-alive',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        keepalive: true
      });

      clearTimeout(timeoutId);

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      if (!response.ok) {
        let errorMessage = 'Failed to get explanation/feedback from AI.';
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      // Check if response is JSON (text-only) or audio
      const contentType = response.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        // Text-only response (TTS failed)
        const jsonData = await response.json();
        if (jsonData.text_response) {
          setAiResponse({ 
            text: jsonData.text_response, 
            audioUrl: '',
            hasAudio: false
          });
          setWarning('Backend audio generation failed. You can use the browser text-to-speech button below.');
        } else {
          throw new Error(jsonData.detail || 'Unknown error occurred.');
        }
        setIsProcessing(false);
        return;
      }

      // Audio response
      const rawAiText = response.headers.get('X-AI-Text-Response') || 'No text response from AI.';
      const aiText = safeDecodeHeader(rawAiText);
      console.log('AI Text:', aiText);

      const audioBlob = await response.blob();
      console.log('Audio blob size:', audioBlob.size);
      
      if (audioBlob.size === 0) {
        throw new Error('Received empty audio response.');
      }

      const audioUrl = URL.createObjectURL(audioBlob);

      setAiResponse({ 
        text: aiText, 
        audioUrl: audioUrl,
        hasAudio: true
      });

      // Play the audio automatically
      const audio = new Audio(audioUrl);
      audio.onloadeddata = () => {
        console.log('Audio loaded successfully');
      };
      audio.onended = () => {
        console.log('Audio playback ended naturally');
        setIsProcessing(false);
      };
      audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        setWarning("Audio loaded but couldn't play. You can still read the text response.");
        setIsProcessing(false);
      };
      
      setPlaybackAudio(audio);
      
      try {
        await audio.play();
        console.log('Audio playback started');
        // Don't set isProcessing to false here - let it finish naturally
      } catch (playError) {
        console.error('Audio play failed:', playError);
        setWarning('Audio ready but autoplay blocked. Click the play button to listen.');
        setIsProcessing(false);
      }

    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timed out. The AI is taking longer than usual - please try again.');
      } else if (err.message?.includes('fetch') || err.message?.includes('network')) {
        setError('Network connection lost. Please check your connection and try again.');
      } else {
        console.error('Explanation/Feedback error:', err);
        setError(err.message || 'Error generating AI response. Please try again.');
      }
      setIsProcessing(false);
    }
  };

  const handleManualTopicSubmit = () => {
    if (topic.trim()) {
      getExplanationOrFeedback(topic.trim());
    } else {
      setError('Please enter a topic to get an explanation.');
    }
  };

  const handleFeedbackRequest = () => {
    if (topic.trim() && userExplanation.trim()) {
      getExplanationOrFeedback(topic.trim(), userExplanation.trim());
    } else if (!topic.trim()) {
      setError('Please enter a topic before seeking feedback.');
    } else {
      setError('Please provide your explanation (via text or voice) before seeking feedback.');
    }
  };

  const playRecordedAudio = () => {
    if (recordedAudioBlob) {
      if (audioRef.current) {
        audioRef.current.src = URL.createObjectURL(recordedAudioBlob);
        audioRef.current.play();
      }
    }
  };

  const playAIAudio = () => {
    if (playbackAudio) {
      // Reset and play from beginning
      playbackAudio.currentTime = 0;
      setIsProcessing(true); // Show that audio is playing
      playbackAudio.play().catch(err => {
        console.error('Manual audio play failed:', err);
        setWarning('Could not play audio. Check browser audio permissions.');
        setIsProcessing(false);
      });
    }
  };

  const playWithBrowserTTS = () => {
    if (aiResponse?.text) {
      speakTextWithBrowserTTS(aiResponse.text);
    }
  };

  const stopPlayback = () => {
    if (playbackAudio) {
      playbackAudio.pause();
      playbackAudio.currentTime = 0;
      setIsProcessing(false);
    }
    // Also stop browser TTS
    stopBrowserTTS();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center p-4">
      <div className="w-full max-w-2xl bg-white shadow-lg rounded-xl overflow-hidden mt-8">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white">
          <h1 className="text-3xl font-extrabold flex items-center mb-2">
            <Lightbulb className="mr-3" size={30} /> AI Learning Agent
          </h1>
          <p className="text-blue-100">Your interactive tutor for any topic.</p>
        </div>

        {/* Main Content Area */}
        <div className="p-6 space-y-6">
          {/* Topic Input */}
          <div>
            <label htmlFor="topic-input" className="block text-gray-700 text-lg font-semibold mb-2">
              <MessageSquareText className="inline-block mr-2 text-blue-500" /> Enter Topic:
            </label>
            <input
              id="topic-input"
              type="text"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-gray-800"
              placeholder="e.g., 'Photosynthesis', 'Python loops'"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              disabled={isProcessing || isRecording}
            />
            <button
              onClick={handleManualTopicSubmit}
              disabled={!topic.trim() || isProcessing || isRecording}
              className="mt-3 w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Get Initial Explanation
            </button>
          </div>

          {/* User Explanation Input/Recording */}
          <div>
            <label htmlFor="user-explanation" className="block text-gray-700 text-lg font-semibold mb-2">
              <User className="inline-block mr-2 text-purple-500" /> Your Explanation:
            </label>
            <textarea
              id="user-explanation"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 text-gray-800 min-h-[100px]"
              placeholder="Type your explanation here, or record it using the mic below..."
              value={userExplanation}
              onChange={(e) => setUserExplanation(e.target.value)}
              disabled={isProcessing || isRecording}
            />
            <div className="flex justify-center space-x-4 mt-3">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={`p-3 rounded-full text-white ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isRecording ? <StopCircle size={24} /> : <Mic size={24} />}
              </button>
              {recordedAudioBlob && (
                <button
                  onClick={playRecordedAudio}
                  disabled={isProcessing}
                  className="p-3 rounded-full bg-gray-500 text-white hover:bg-gray-600 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Play size={24} />
                </button>
              )}
            </div>
            {isRecording && <p className="text-center text-red-500 mt-2 animate-pulse">Recording...</p>}
            <audio ref={audioRef} className="hidden"></audio>

            <button
              onClick={handleFeedbackRequest}
              disabled={!topic.trim() || !userExplanation.trim() || isProcessing || isRecording}
              className="mt-4 w-full bg-purple-600 text-white py-2 rounded-lg hover:bg-purple-700 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Get Feedback on My Explanation
            </button>
          </div>

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="flex items-center justify-center p-4 bg-blue-50 rounded-lg text-blue-700 font-medium">
              <Loader2 className="animate-spin mr-3" size={20} /> Processing AI response...
            </div>
          )}

          {/* Warning Messages */}
          {warning && (
            <div className="p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded-lg flex items-start">
              <AlertCircle className="mr-2 mt-0.5 flex-shrink-0" size={20} />
              <div>
                <p className="font-semibold">Notice:</p>
                <p>{warning}</p>
              </div>
            </div>
          )}

          {/* Error Messages */}
          {error && (
            <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
              <p className="font-semibold">Error:</p>
              <p>{error}</p>
            </div>
          )}

          {/* AI Response Area */}
          {aiResponse && (
            <div className="bg-blue-50 p-4 rounded-lg shadow-inner">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-blue-800 flex items-center">
                  <Speaker className="mr-2" size={20} /> AI Tutor says:
                </h3>
                <div className="flex space-x-2">
                  {aiResponse.hasAudio && (
                    <>
                      <button
                        onClick={playAIAudio}
                        disabled={isProcessing && !isUsingSpeechSynthesis}
                        className="p-2 rounded-full bg-green-500 text-white hover:bg-green-600 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Play premium AI voice"
                      >
                        <Play size={20} />
                      </button>
                    </>
                  )}
                  <button
                    onClick={playWithBrowserTTS}
                    disabled={isProcessing && !isUsingSpeechSynthesis}
                    className="p-2 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Read with browser voice"
                  >
                    <Volume2 size={20} />
                  </button>
                  <button
                    onClick={stopPlayback}
                    disabled={!isProcessing}
                    className="p-2 rounded-full bg-gray-400 text-white hover:bg-gray-500 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Stop playback"
                  >
                    <StopCircle size={20} />
                  </button>
                </div>
              </div>
              <p className="text-gray-800 whitespace-pre-wrap">{aiResponse.text}</p>
              {!aiResponse.hasAudio && (
                <p className="text-sm text-gray-500 mt-2 italic">Premium AI voice not available - use browser voice button above.</p>
              )}
              {isUsingSpeechSynthesis && (
                <div className="flex items-center mt-2 text-blue-600">
                  <Volume2 className="mr-2 animate-pulse" size={16} />
                  <span className="text-sm">Reading with browser voice...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}