const socket = io();
const ctx = document.getElementById("pidChart").getContext("2d");

const znChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [], 
        datasets: [
            { label: 'Actual Angle', data: [], borderColor: 'blue', tension: 0.2, pointRadius: 2 },
            { label: 'Setpoint', data: [], borderColor: 'red', borderDash: [5, 5], pointRadius: 0 }
        ]
    },
    options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, suggestedMax: 100 } }
    }
});

let startTime = null;

socket.on('realtimeData', (data) => {
    if (!startTime) startTime = Date.now();
    const t = ((Date.now() - startTime) / 1000).toFixed(1);
    
    znChart.data.labels.push(t);
    znChart.data.datasets[0].data.push(data.actualValue);
    znChart.data.datasets[1].data.push(data.setpoint || 90);
    
    if (znChart.data.labels.length > 50) {
        znChart.data.labels.shift();
        znChart.data.datasets.forEach(d => d.data.shift());
    }
    znChart.update();
    document.getElementById('steadyStateErrorValue').innerText = data.steadyStateError || "0.00";
});

socket.on('kp-climb', (data) => {
    document.getElementById('kpClimbValue').innerText = data.currentKp;
    document.getElementById('statusText').innerText = "Searching for Ku...";
});
socket.on('zn-finished', (data) => {
    // 1. Kunin ang piniling setpoint mula sa UI
    const selectedSetpoint = parseInt(document.getElementById('setpointSelect').value);

    // 2. I-update ang UI gaya ng dati
    document.getElementById('kuValue').innerText = data.Ku.toFixed(3);
    document.getElementById('tuValue').innerText = data.Tu.toFixed(3) + "s";
    document.getElementById('resultKp').innerText = data.kp.toFixed(3);
    document.getElementById('resultKi').innerText = data.ki.toFixed(3);
    document.getElementById('resultKd').innerText = data.kd.toFixed(3);
    
    document.getElementById('statusText').innerText = `Applied to ESP32 at ${selectedSetpoint}°!`;

    // 3. Ipadala ang command sa server gamit ang napiling setpoint
    fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            kp: parseFloat(data.kp.toFixed(2)), 
            ki: parseFloat(data.ki.toFixed(2)), 
            kd: parseFloat(data.kd.toFixed(2)), 
            set: selectedSetpoint // <--- Gagamitin na ang 45 o 90 dito
        })
    });
});

document.getElementById('start_tuning').addEventListener('click', () => {
    const selectedSetpoint = parseInt(document.getElementById('setpointSelect').value) || 90;

    startTime = null;
    znChart.data.labels = [];
    znChart.data.datasets.forEach(d => d.data = []);
    
    // Ipakita sa status kung anong setpoint ang tinu-tune
    document.getElementById('statusText').innerText = `Tuning at ${selectedSetpoint}°...`;
    
    // Reset previous result displays
    document.getElementById('resultKp').innerText = "---";
    document.getElementById('resultKi').innerText = "---";
    document.getElementById('resultKd').innerText = "---";
    
    // padala ung setpoint sa server
    socket.emit('start-zn', { setpoint: selectedSetpoint });
});