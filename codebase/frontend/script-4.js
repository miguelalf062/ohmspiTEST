const socket = io('http://localhost:3000');
socket.on('testTopic', (data) => {
    console.log('Received data from server:', data);
});


const ctx = document.getElementById("pidChart").getContext("2d");
const maxDataPoints = 50;
const maxSamples = 200;

const znChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [], // timestamps in ms
    datasets: [
      {
        label: 'Actual Value',
        data: [],
        borderColor: 'blue',
        fill: false,
        tension: 0.2
      },
      {
        label: 'Setpoint',
        data: [],
        borderColor: 'red',
        borderDash: [5, 5],
        fill: false
      },
      {
        label: 'Peaks',
        data: [],
        borderColor: 'green',
        pointStyle: 'triangle',
        pointRadius: 8,
        showLine: false
      }
    ]
  },
  options: {
    animation: false,
    responsive: true,
    scales: {
      x: {
        type: 'linear',
        title: { display: true, text: 'Time (ms)' }
      },
      y: {
        title: { display: true, text: 'Value' }
      }
    }
  }
});


let startTime = null;

socket.on('zn-update', (data) => {
  if (!startTime) startTime = data.timestamp;
  const t = (data.timestamp - startTime) / 1000; // seconds

  // push actual value and setpoint
  znChart.data.labels.push(t);
  znChart.data.datasets[0].data.push(data.actualValue);
  znChart.data.datasets[1].data.push(100); // constant setpoint

  // push peak only if detected
  if(data.P_P){
    znChart.data.datasets[2].data.push({x: t, y: data.actualValue});
  }

  // limit to max samples
  if (znChart.data.labels.length > maxSamples) {
    znChart.data.labels.shift();
    znChart.data.datasets.forEach(ds => {
      if(ds.showLine === false) ds.data = ds.data.filter(pt => pt.x >= t - maxSamples/10);
      else ds.data.shift();
    });
  }

  znChart.update();
});

// Show final Ku/Tu when done
socket.on('zn-finished', (data) => {
  alert(`Ziegler-Nichols finished!\nKu = ${data.Ku}\nTu = ${data.Tu}`);
});
document.getElementById('start_tuning').addEventListener('click', () => {
  socket.emit('start-zn');
});
