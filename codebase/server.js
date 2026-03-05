const express = require("express");
const mqtt = require("mqtt");
const path = require("path");
const { Client } = require("pg");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
//server port
const port = 3000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());

const mqttClient = mqtt.connect("mqtt://localhost:1883"); //may need to be adjusted to RPi's IP

//connection to the database
const con = new Client({
  host: "localhost",
  username: "bulsu",
  port: 5432,
  password: "1234567890...",
  database: "pidData",
});
con.connect().then(() => console.log("Connected to Database"));

// MQTT setup
mqttClient.on("connect", () => {
  console.log("Backend connected to MQTT server");
  //subscribes the server to "performanceData" topic
  mqttClient.subscribe("performanceData");
});

// Middleware to parse JSON from frontend
app.use(express.json());
app.use(express.static("public")); // Serves your HTML file

// Send commands from Frontend to ESP32
app.post("/api/command", (req, res) => {
  const { kp, ki, kd, set } = req.body;
  const payload = JSON.stringify({
    kp: kp || null,
    ki: ki || null,
    kd: kd || null,
    set,
  });

  // 1. Wipe the database table
  const clearQuery = "TRUNCATE TABLE performancedata"; // Use TRUNCATE for a fast, total wipe

  con.query(clearQuery, (err) => {
    if (err) {
      console.error("Error clearing database:", err.message);
      return res.status(500).json({ error: "Failed to clear old data" });
    }

    console.log("Database table performancedata wiped.");

    // 2. Tell the frontend to clear the graph
    io.emit("clearGraph");

    // 3. Publish the new PID values to the ESP32
    mqttClient.publish("commandData", payload, (mqttErr) => {
      if (mqttErr) return res.status(500).json({ error: "Failed to publish" });
      res.json({ status: "Database wiped and command sent!" });
    });
  });
});


// ZIEGLERS NICHOLS TUNING METHOD
let doZiegler = false;
let samples = [];
let peakTimes = [];
let lastPeak = null;
let rising = null;
let peakToPeaks = [];
let cycleCount = 0;
let znClient = null;

async function sendKpToEsp32(kpValue, ki = 0, kd = 0, setpoint = 100) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ kp: kpValue, ki, kd, set: setpoint });
    mqttClient.publish("commandData", payload, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function detectPeak(samples) {
  if (samples.length < 3) return null;

  const a = samples[samples.length - 3].value;
  const b = samples[samples.length - 2].value;
  const c = samples[samples.length - 1].value;

  if (b > a && b > c) {
    return { peak: b, time: samples[samples.length - 2].time };
  } else if (b < a && b < c) {
    return { trough: b, time: samples[samples.length - 2].time };
  }

  return null;
}

function detectOscillation() {
  if (samples.length < 2) return null;

  const current = samples[samples.length - 1];
  const prev = samples[samples.length - 2];

  const threshold = 0.05; // ignore small noise
  if (Math.abs(current.value - prev.value) < threshold) return null;

  if (current.value > prev.value) rising = true;
  else if (current.value < prev.value && rising) {
    // Peak detected
    if (lastPeak) {
      const P_P = Math.abs(lastPeak.value - current.value);
      peakToPeaks.push(P_P);
      if (peakToPeaks.length > 5) peakToPeaks.shift();
      cycleCount++;

      // Check sustained oscillation: variation < 10%
      const maxPP = Math.max(...peakToPeaks);
      const minPP = Math.min(...peakToPeaks);
      const avgPP = peakToPeaks.reduce((a, b) => a + b, 0) / peakToPeaks.length;
      const sustained = (maxPP - minPP) / avgPP < 0.1;

      // Compute Tu (average period)
      let Tu = null;
      if (peakTimes.length >= 2) {
        const periods = [];
        for (let i = 1; i < peakTimes.length; i++) {
          periods.push(peakTimes[i] - peakTimes[i - 1]);
        }
        Tu = periods.reduce((a, b) => a + b, 0) / periods.length;
      }

      return { cycle: cycleCount, P_P, sustained, Tu };
    }

    lastPeak = { value: current.value, time: current.time };
    peakTimes.push(current.time);
    rising = false;
  }
  return null;
}

// For receiving MQTT data
mqttClient.on("message", (topic, message) => {
  try {
    const data = JSON.parse(message.toString());

    if (topic === "performanceData") {
      const insertQuery = `
        INSERT INTO performanceData (riseTime, settlingTime, steadyStateError, overshoot, setpoint, actualValue) 
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      const values = [
        data.riseTime,
        data.settlingTime,
        data.steadyStateError,
        data.overshoot,
        data.setpoint,
        data.actualValue,
      ];

      con.query(insertQuery, values, (err, result) => {
        if (err) {
          console.error("Database Error:", err.message);
        } else {
          console.log("Performance data saved to DB");
        }
      });
      io.emit("realtimeData", data);

      if (!doZiegler) return;

      // Push current sample
      samples.push({ value: data.actualValue, time: data.timestamp });

      const peakData = detectPeak(samples);

      if (peakData && peakData.peak) {
        // Record peak-to-peak amplitude
        if (lastPeak) {
          const P_P = Math.abs(peakData.peak - lastPeak.value);
          peakToPeaks.push(P_P);
          if (peakToPeaks.length > 5) peakToPeaks.shift();
          cycleCount++;

          // Compute Tu (average period)
          peakTimes.push(peakData.time);
          let Tu = null;
          if (peakTimes.length >= 2) {
            const periods = [];
            for (let i = 1; i < peakTimes.length; i++) {
              periods.push(peakTimes[i] - peakTimes[i - 1]);
            }
            Tu = periods.reduce((a, b) => a + b, 0) / periods.length;
          }

          // Emit progress to front-end
          if (znClient) {
            znClient.emit('zn-update', { cycle: cycleCount, P_P, sustained: peakToPeaks.length >= 5, Tu, actualValue: data.actualValue, timestamp: data.timestamp });
          }

          // Stop Ziegler when 5 peaks detected
          if (peakToPeaks.length >= 5) {
            doZiegler = false;
            console.log('Ziegler-Nichols finished!');
            if (znClient) {
              znClient.emit('zn-finished', { Ku: currentKp, Tu });
            }
          }
        }

        // Update lastPeak
        lastPeak = { value: peakData.peak, time: peakData.time };
      }

    }
  } catch (error) {
    console.error("Received message was not valid JSON", error);
  }
});


let currentKp = 0;

io.on('connection', (socket) => {
  console.log('Frontend connected:', socket.id);
  znClient = socket;

  socket.on('start-zn', async () => {
    console.log('Starting Ziegler-Nichols measurement');

    // Reset ZN state
    doZiegler = true;
    samples = [];
    peakToPeaks = [];
    peakTimes = [];
    cycleCount = 0;
    lastPeak = null;
    rising = null;

    currentKp = 0;
    const kpStep = 0.05;
    const maxKp = 10;
    const setpoint = 90;

    while (doZiegler && currentKp <= maxKp) {
      await sendKpToEsp32(currentKp, 0, 0, setpoint);
      currentKp += kpStep;
      await new Promise(r => setTimeout(r, 500));
    }

    if (!doZiegler) {
      console.log('Ziegler-Nichols done.');
    }
  });

  socket.on('disconnect', () => {
    console.log('Frontend disconnected:', socket.id);
    znClient = null;
  });
});


//serve static files
app.use(express.static(path.join(__dirname, "frontend")));

server.listen(port, () => {
  console.log(`Server and WebSockets listening on port ${port}`);
});
