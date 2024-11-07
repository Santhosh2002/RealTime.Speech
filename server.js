process.env.GOOGLE_APPLICATION_CREDENTIALS = "./credentials.json"; // Ensure path is correct

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { SpeechClient } = require("@google-cloud/speech");
const { TextToSpeechClient } = require("@google-cloud/text-to-speech");
const cors = require("cors");
const stream = require("stream");

const app = express();
app.use(cors()); // Enable CORS for client access

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = 5000;

// Google Cloud clients
const speechClient = new SpeechClient();
const textToSpeechClient = new TextToSpeechClient();

let lastTranscription = ""; // Store last transcription to filter duplicates

// WebSocket connection for real-time transcription
wss.on("connection", (ws) => {
  console.log("Client connected");

  let recognizeStream = null;

  ws.on("message", (data) => {
    if (!recognizeStream) {
      // Initialize Google Cloud recognize stream for speech-to-text
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

            // Only send if transcription differs from last to prevent repeats
            if (transcription !== lastTranscription) {
              ws.send(transcription); // Send transcription to client
              lastTranscription = transcription;
              console.log("Transcription:", transcription);
            }
          }
        })
        .on("error", (error) => {
          console.error("Error:", error);
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
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (recognizeStream) {
      recognizeStream.end();
      recognizeStream = null;
    }
  });
});

// REST endpoint for Text-to-Speech
app.get("/text-to-speech", async (req, res) => {
  const { text } = req.query; // Get text from query parameters

  // Set up request for Google Text-to-Speech
  const request = {
    input: { text },
    voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
    audioConfig: { audioEncoding: "MP3" },
  };

  try {
    // Performs the Text-to-Speech request
    const [response] = await textToSpeechClient.synthesizeSpeech(request);

    // Send audio back to client
    res.set("Content-Type", "audio/mpeg");
    res.send(response.audioContent);
  } catch (error) {
    console.error("Error during Text-to-Speech request:", error);
    res.status(500).send("Error processing text-to-speech");
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
