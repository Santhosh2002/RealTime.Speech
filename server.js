process.env.GOOGLE_APPLICATION_CREDENTIALS = "./credentials.json"; // Ensure path is correct

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { SpeechClient } = require("@google-cloud/speech");
const { TextToSpeechClient } = require("@google-cloud/text-to-speech");
const cors = require("cors");
const stream = require("stream");
const morgan = require("morgan");

const app = express();
app.use(cors()); // Enable CORS for client access
app.use(morgan("combined")); // Use morgan for HTTP request logging

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const port = process.env.PORT || 8080;

// Google Cloud clients
const speechClient = new SpeechClient();
const textToSpeechClient = new TextToSpeechClient();

let lastTranscription = ""; // Store last transcription to filter duplicates

// WebSocket connection for real-time transcription
wss.on("connection", (ws) => {
  console.log("WebSocket connection established with client");

  let recognizeStream = null;

  ws.on("message", (data) => {
    console.log("Received data from client:", data);

    if (!recognizeStream) {
      console.log("Initializing Google Cloud Speech streaming recognize");
      recognizeStream = speechClient
        .streamingRecognize({
          config: {
            encoding: "WEBM_OPUS",
            sampleRateHertz: 16000,
            languageCode: "en-US",
            model: "default",
          },
          interimResults: false, // Disable interim to reduce duplicates
        })
        .on("data", (response) => {
          const result = response.results[0];

          if (result && result.isFinal) {
            const transcription = result.alternatives[0].transcript.trim();

            if (transcription !== lastTranscription) {
              ws.send(transcription); // Send transcription to client
              lastTranscription = transcription;
              console.log("Transcription sent to client:", transcription);
            }
          }
        })
        .on("error", (error) => {
          console.error("Google Cloud Speech streaming error:", error);
          if (recognizeStream) {
            recognizeStream.end();
            recognizeStream = null;
          }
        })
        .on("end", () => {
          console.log("Google Speech stream ended.");
          recognizeStream = null;
        });
    }

    // Stream audio chunks to Google Cloud
    if (recognizeStream) {
      const audioBufferStream = new stream.PassThrough();
      audioBufferStream.end(data);
      audioBufferStream.pipe(recognizeStream, { end: false });
      console.log("Audio data piped to Google Speech API");
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected from WebSocket");
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
    }
  });
});

// REST endpoint for Text-to-Speech
app.get("/text-to-speech", async (req, res) => {
  const { text } = req.query; // Get text from query parameters
  console.log("Received text for TTS:", text);

  const request = {
    input: { text },
    voice: {
      languageCode: "en-IN",
      ssmlGender: "FEMALE",
      name: "en-IN-Journey-O",
    },
    audioConfig: { audioEncoding: "MP3" },
  };

  try {
    const [response] = await textToSpeechClient.synthesizeSpeech(request);
    console.log("Text-to-Speech audio generated");

    res.set("Content-Type", "audio/mpeg");
    res.send(response.audioContent);
  } catch (error) {
    console.error("Error during Text-to-Speech request:", error);
    res.status(500).send("Error processing text-to-speech");
  }
});

// Start the server
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
