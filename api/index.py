from flask import Flask, request, jsonify, Response
import os
import tempfile
import uuid
from dotenv import load_dotenv
import openai
import requests
import time
import base64

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Initialize OpenAI client
openai_api_key = os.getenv("OPENAI_API_KEY")
if openai_api_key:
    openai_client = openai.OpenAI(api_key=openai_api_key)
else:
    openai_client = None
    print("Warning: OPENAI_API_KEY not found in .env file.")

# Initialize ElevenLabs API key
elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
if not elevenlabs_api_key:
    print("Warning: ELEVENLABS_API_KEY not found in .env file.")

def safe_encode_for_header(text):
    """Safely encode text for HTTP headers by removing non-Latin-1 characters"""
    try:
        # Try to encode as Latin-1 first
        text.encode('latin-1')
        return text
    except UnicodeEncodeError:
        # If that fails, encode as base64
        encoded_bytes = text.encode('utf-8')
        b64_encoded = base64.b64encode(encoded_bytes).decode('ascii')
        return f"base64:{b64_encoded}"

def safe_decode_header(header_value):
    """Decode header value if it was base64 encoded"""
    if header_value.startswith("base64:"):
        b64_data = header_value[7:]  # Remove "base64:" prefix
        decoded_bytes = base64.b64decode(b64_data)
        return decoded_bytes.decode('utf-8')
    return header_value

@app.route("/", methods=["GET"])
def root():
    return jsonify({"message": "Hello from Flask Backend!"})

@app.route("/api/test", methods=["GET"])
def test_api():
    sample_env_var = os.getenv("SAMPLE_ENV_VAR", "Not Set")
    return jsonify({
        "data": "This is data from the backend!", 
        "env_var_status": sample_env_var,
        "openai_status": "Available" if openai_client else "Not Available",
        "elevenlabs_status": "Available" if elevenlabs_api_key else "Not Available"
    })

@app.route("/api/transcribe", methods=["POST"])
def transcribe_audio():
    if not openai_client:
        return jsonify({"detail": "OpenAI API key is not set."}), 500

    if 'audio_file' not in request.files:
        return jsonify({"detail": "No audio_file part in the request"}), 400

    audio_file = request.files['audio_file']

    if not audio_file.filename or not audio_file.filename.endswith(('.mp3', '.wav', '.m4a', '.webm')):
        return jsonify({"detail": "Invalid file type. Only common audio files are accepted."}), 400

    temp_audio_path = None
    try:
        temp_audio_path = f"temp_audio_{uuid.uuid4()}.wav"
        audio_file.save(temp_audio_path)

        with open(temp_audio_path, "rb") as audio:
            transcript = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=audio
            )
        
        return jsonify({"transcript": transcript.text})
    except Exception as e:
        print(f"Transcription error: {e}")
        return jsonify({"detail": str(e)}), 500
    finally:
        if temp_audio_path and os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)

def generate_audio_with_retries(text, max_retries=3):
    """Generate audio with retry logic and multiple voice options"""
    
    # Try different voices if the first one fails
    voice_options = [
        "ZF6FPAbjXT4488VcRRnw",  # Original voice - Amelia
        # "21m00Tcm4TlvDq8ikWAM",  # Rachel - reliable fallback
        # "AZnzlk1XvdvUeBnXmlld",  # Domi - another option
    ]
    
    for voice_id in voice_options:
        for attempt in range(max_retries):
            try:
                print(f"Attempting TTS with voice {voice_id}, attempt {attempt + 1}")
                
                url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
                
                headers = {
                    "Accept": "audio/mpeg",
                    "Content-Type": "application/json",
                    "xi-api-key": elevenlabs_api_key
                }
                
                # Simplified payload - remove potentially problematic settings
                payload = {
                    "text": text[:2500],  # Increased limit for longer responses
                    "model_id": "eleven_flash_v2_5",  # Use simpler model
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.5,
                        "style": 0.0,
                        "use_speaker_boost": True
                    }
                }
                
                # Make request with timeout and streaming
                response = requests.post(
                    url, 
                    json=payload, 
                    headers=headers, 
                    timeout=45,  # Increased timeout for longer text
                    stream=True  # Enable streaming to prevent timeouts
                )
                
                print(f"TTS Response status: {response.status_code}")
                
                if response.status_code == 200:
                    # Read the streamed content
                    audio_content = b''
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            audio_content += chunk
                    return audio_content
                elif response.status_code == 429:
                    print("Rate limited, waiting before retry...")
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                else:
                    print(f"TTS Error {response.status_code}: {response.text}")
                    if attempt == max_retries - 1:
                        continue  # Try next voice
                    time.sleep(1)
                    
            except requests.exceptions.Timeout:
                print(f"TTS request timed out on attempt {attempt + 1}")
                if attempt < max_retries - 1:
                    time.sleep(2)
                    continue
            except requests.exceptions.ConnectionError as e:
                print(f"Connection error: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2)
                    continue
            except Exception as e:
                print(f"Unexpected TTS error: {e}")
                if attempt < max_retries - 1:
                    time.sleep(1)
                    continue
        
        print(f"Failed with voice {voice_id}, trying next voice...")
    
    print("All TTS attempts failed")
    return None

@app.route("/api/explain", methods=["POST"])
def get_explanation():
    if not openai_client:
        return jsonify({"detail": "OpenAI API key is not set."}), 500

    data = request.get_json()
    if not data:
        return jsonify({"detail": "Invalid JSON body"}), 400

    topic = data.get("topic")
    user_explanation = data.get("user_explanation", "")
    
    if not topic:
        return jsonify({"detail": "Topic is required."}), 400

    messages = [
        {"role": "system", "content": "You are an expert, concise, and encouraging AI tutor. Provide clear explanations and constructive feedback. Use simple, direct language. Keep responses under 400 words for comprehensive yet manageable audio generation."}
    ]

    if user_explanation:
        messages.append(
            {"role": "user", "content": f"The topic is: '{topic}'. The user's explanation is: '{user_explanation}'. Please provide constructive feedback on their explanation, pointing out strengths and areas for improvement."}
        )
    else:
        messages.append(
            {"role": "user", "content": f"Explain the following topic concisely and clearly in under 200 words: '{topic}'."}
        )

    try:
        # Get AI response
        chat_completion = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=400,  # Increased for more complete responses
            temperature=0.7
        )
        ai_text_response = chat_completion.choices[0].message.content
        print("Starting TTS generation...")

        # Clean up text for TTS
        cleaned_text = ai_text_response.replace('\n', ' ').replace('\r', ' ').strip()
        
        # Try to generate audio if ElevenLabs is available
        audio_bytes = None
        if elevenlabs_api_key:
            print("Generating audio with ElevenLabs...")
            audio_bytes = generate_audio_with_retries(cleaned_text)
            print(f"TTS generation completed. Audio size: {len(audio_bytes) if audio_bytes else 0} bytes")
        
        if audio_bytes:
            # Success - return audio with text header and keep-alive
            response = Response(audio_bytes, mimetype="audio/mpeg")
            # Safely encode the text for the header
            safe_text = safe_encode_for_header(cleaned_text[:8000])  # Increased header size limit
            response.headers["X-AI-Text-Response"] = safe_text
            response.headers["Access-Control-Expose-Headers"] = "X-AI-Text-Response"
            response.headers["Connection"] = "keep-alive"
            response.headers["Content-Length"] = str(len(audio_bytes))
            return response
        else:
            # TTS failed - return text only
            print("TTS failed, returning text only")
            return jsonify({
                "text_response": ai_text_response,
                "audio_error": "Text-to-speech temporarily unavailable"
            })
            
    except Exception as e:
        print(f"Explain endpoint error: {e}")
        return jsonify({"detail": f"AI Error: {str(e)}"}), 500

@app.route("/api/text-to-speech", methods=["POST"])
def text_to_speech_route():
    if not elevenlabs_api_key:
        return jsonify({"detail": "Eleven Labs API key is not set."}), 500

    data = request.get_json()
    input_text = data.get("text")
    if not input_text:
        return jsonify({"detail": "No text provided for TTS."}), 400

    audio_bytes = generate_audio_with_retries(input_text)
    
    if audio_bytes:
        return Response(audio_bytes, mimetype="audio/mpeg")
    else:
        return jsonify({"detail": "TTS service temporarily unavailable"}), 503

# Test endpoint specifically for ElevenLabs
@app.route("/api/test-tts", methods=["POST"])
def test_tts():
    if not elevenlabs_api_key:
        return jsonify({"detail": "Eleven Labs API key is not set."}), 500
    
    test_text = "Hello, this is a test of the text to speech system."
    audio_bytes = generate_audio_with_retries(test_text)
    
    if audio_bytes:
        return jsonify({"status": "success", "message": "TTS is working"})
    else:
        return jsonify({"status": "failed", "message": "TTS is not working"}), 500

if __name__ == '__main__':
    app.run(debug=True)