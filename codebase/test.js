// realistic_fake_esp32.js
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://localhost'); // replace with your broker

client.on('connect', () => {
  console.log('Fake ESP32 connected to MQTT broker');
});

// --- PID & physics variables ---
let setpoint = 90;       // target angle in degrees
let theta = 0;           // current angle (degrees)
let omega = 0;           // angular velocity (deg/s)
let dt = 0.1;            // 100ms time step
let Kp = 0, Ki = 0, Kd = 0;
let integral = 0;
let prevError = 0;

// Subscribe to PID commands
client.subscribe('commandData');
client.on('message', (topic, message) => {
  if (topic === 'commandData') {
    const cmd = JSON.parse(message.toString());
    if (cmd.kp !== null) Kp = cmd.kp;
    if (cmd.ki !== null) Ki = cmd.ki;
    if (cmd.kd !== null) Kd = cmd.kd;
    if (cmd.set !== null) setpoint = cmd.set;
  }
});

// Physics constants
const g = 9.81;          // gravity m/s²
const l = 0.5;           // stick length in meters
const mass = 0.2;        // kg
const maxTorque = 10;     // max motor torque

// Publish simulated ESP32 data every 100ms
setInterval(() => {
  // --- PID control ---
  const error = setpoint - theta;
  integral += error * dt;
  const derivative = (error - prevError) / dt;
  prevError = error;

  let torque = Kp * error + Ki * integral + Kd * derivative;
  // Limit torque to motor capability
  if (torque > maxTorque) torque = maxTorque;
  if (torque < -maxTorque) torque = -maxTorque;

  // --- Physics update (simple inverted pendulum) ---
  const alpha = (torque / (mass * l * l)) - (g / l) * Math.sin(theta * Math.PI/180); // angular acceleration
  omega += alpha * dt;
  theta += omega * dt;

  // Add some sensor noise
  const actualValue = theta + (Math.random() - 0.5) * 0.5;

  // --- Performance metrics (approximate for simulation) ---
  const riseTime = Math.max(0, 50 - Math.abs(error));
  const settlingTime = Math.max(0, 100 - Math.abs(error));
  const steadyStateError = Math.abs(error);
  const overshoot = Math.max(0, actualValue - setpoint);

  const payload = JSON.stringify({
    riseTime,
    settlingTime,
    steadyStateError,
    overshoot,
    setpoint,
    actualValue,
    timestamp: Date.now()
  });

  client.publish('performanceData', payload);

}, dt * 1000); // every 100ms