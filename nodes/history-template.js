module.exports = function(RED) {
    function HistoryTemplateNode(config) {
        RED.nodes.createNode(this, config);
        this.chartConfig = RED.nodes.getNode(config.chartConfig);
        this.name = config.name;
        const node = this;

        node.on('input', function(msg) {
            if (!node.chartConfig) {
                node.error("No chart configuration defined", msg);
                return;
            }
            const bucket = node.chartConfig.name;
            if (!bucket) {
                node.error("No bucket defined in chart configuration", msg);
                return;
            }

            // Parse line protocol from msg.payload
            const lines = Array.isArray(msg.payload) ? msg.payload : [];
            const chartData = {};

            for (let line of lines) {
                try {
                    // Split line into measurement+tags, fields, and timestamp
                    const match = line.match(/^(.+?) (value=[0-9.]+) ([0-9]+)$/);
                    if (!match) {
                        node.warn(`Failed to parse line: ${line}`);
                        continue;
                    }
                    const [_, measurementTags, fields, timestamp] = match;

                    // Split measurement and tags
                    const [measurement, ...tagPairs] = measurementTags.split(',');
                    const tags = {};
                    tagPairs.forEach(pair => {
                        const [key, value] = pair.split('=');
                        if (key && value) {
                            tags[key] = value.replace(/\\ /g, ' '); // Unescape spaces
                        }
                    });

                    // Parse fields
                    const fieldPairs = fields.split(',');
                    const values = {};
                    fieldPairs.forEach(pair => {
                        const [key, value] = pair.split('=');
                        if (key && value) {
                            values[key] = parseFloat(value);
                        }
                    });

                    const seriesName = tags.seriesName;
                    if (!seriesName) {
                        node.warn(`Skipping line with no seriesName: ${line}`);
                        continue;
                    }

                    if (!chartData[seriesName]) {
                        chartData[seriesName] = [];
                    }

                    chartData[seriesName].push({
                        timestamp: parseInt(timestamp) / 1e6, // ns to ms
                        value: values.value
                    });
                } catch (e) {
                    node.warn(`Failed to parse line: ${line}, error: ${e.message}`);
                }
            }

            let series = [{}];
            let data = [[]];

            // Function to convert hex to RGB
            const hexToRgb = (hex) => {
                const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
                hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
                return result ? {
                    r: parseInt(result[1], 16),
                    g: parseInt(result[2], 16),
                    b: parseInt(result[3], 16)
                } : null;
            };

            for (let seriesName in chartData) {
                let seriesData = chartData[seriesName] || [];

                const seriesConfig = node.chartConfig.series.find(s => s.seriesName === seriesName) || {};
                const baseColor = seriesConfig.seriesColor || '#be1313';
                let gradientColors;

                // Convert baseColor to rgba for gradient
                if (baseColor.startsWith('#')) {
                    const rgb = hexToRgb(baseColor);
                    if (rgb) {
                        gradientColors = [
                            { offset: 0, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)` },
                            { offset: 1, color: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.125)` }
                        ];
                    } else {
                        gradientColors = [
                            { offset: 0, color: 'rgba(190, 19, 19, 0.5)' },
                            { offset: 1, color: 'rgba(190, 19, 19, 0.125)' }
                        ];
                    }
                } else if (baseColor.startsWith('rgb')) {
                    const rgbMatch = baseColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                    if (rgbMatch) {
                        const [, r, g, b] = rgbMatch;
                        gradientColors = [
                            { offset: 0, color: `rgba(${r}, ${g}, ${b}, 0.5)` },
                            { offset: 1, color: `rgba(${r}, ${g}, ${b}, 0.125)` }
                        ];
                    } else {
                        gradientColors = [
                            { offset: 0, color: 'rgba(190, 19, 19, 0.5)' },
                            { offset: 1, color: 'rgba(190, 19, 19, 0.125)' }
                        ];
                    }
                } else {
                    gradientColors = [
                        { offset: 0, color: 'rgba(190, 19, 19, 0.5)' },
                        { offset: 1, color: 'rgba(190, 19, 19, 0.125)' }
                    ];
                }

                series.push({ 
                    label: seriesName,
                    units: seriesConfig.seriesUnits || '',
                    color: baseColor,
                    gradientColors: gradientColors // Store gradient colors
                });
                let values = [];

                for (let i = 0; i < seriesData.length; i++) {
                    if (i >= data[0].length) {
                        const ts = seriesData[i].timestamp;
                        data[0].push(ts);
                        for (let j = 1; j < data.length; j++) {
                            while (data[j].length < data[0].length) {
                                data[j].push(NaN);
                            }
                        }
                    }
                    values.push(seriesData[i].value !== null && !isNaN(seriesData[i].value) ? seriesData[i].value : NaN);
                }

                data.push(values);
            }

            for (let i = 1; i < data.length; i++) {
                while (data[i].length < data[0].length) {
                    data[i].push(NaN);
                }
            }

            const chartDataForECharts = { series, data };

            // Get timeSpan for dropdown selection
            const timeSpan = msg.timeSpan ? parseInt(msg.timeSpan) : 604800; // Default to 7 days

            const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ECharts - ${bucket}</title>
  <script src="/echarts.min.js"></script>
  <style>
    html, body { margin: 0; padding: 0; font-family: sans-serif; }
    #main { width: 100vw; height: 100vh; }
    #controls {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 10;
      background: white;
      padding: 5px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <div id="controls">
    <select id="timeSpan" onchange="updateChart()">
      <option value="86400" ${timeSpan === 86400 ? 'selected' : ''}>Last Day</option>
      <option value="604800" ${timeSpan === 604800 ? 'selected' : ''}>Last Week</option>
      <option value="2592000" ${timeSpan === 2592000 ? 'selected' : ''}>Last Month</option>
    </select>
  </div>
  <div id="main"></div>
<script>
  const data = ${JSON.stringify(chartDataForECharts)};
  function updateChart() {
    const timeSpan = parseInt(document.getElementById('timeSpan').value);
    const url = new URL(window.location);
    url.searchParams.set('timeSpan', timeSpan);
    window.location = url.toString();
  }
  if (!data.series || !data.data || data.series.length <= 1) {
    console.error('Invalid data format:', data);
    document.getElementById('main').innerHTML = '<h1>No Data Available</h1><p>Please check the data source.</p>';
  } else {
    const timestamps = data.data[0]; // Timestamps in ms (UTC)
    const legendData = data.series.slice(1).map(s => s.label);
    const seriesData = data.data.slice(1).map((values, i) => ({
      name: data.series[i + 1].label,
      type: 'line',
      smooth: true,
      symbol: 'none',
      data: timestamps.map((t, j) => [t, values[j]]),
      lineStyle: { color: data.series[i + 1].color },
      itemStyle: { color: data.series[i + 1].color },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, data.series[i + 1].gradientColors),
        opacity: 0.7
      },
      z: i + 1
    }));

    let dataMin = Infinity, dataMax = -Infinity;
    data.data.slice(1).forEach(values => {
      values.forEach(v => {
        if (!isNaN(v)) {
          dataMin = Math.min(dataMin, v);
          dataMax = Math.max(dataMax, v);
        }
      });
    });
    if (dataMin === Infinity) dataMin = 0;
    if (dataMax === -Infinity) dataMax = 100;
    const range = dataMax - dataMin;
    const padding = range * 0.5 || 10;
    const paddedMin = Number((dataMin - padding).toFixed(2));
    const paddedMax = Number((dataMax + padding).toFixed(2));

    const yAxisName = data.series.slice(1).map(s => s.units).filter(u => u).join(', ') || 'Value';

    const chart = echarts.init(document.getElementById('main'), null, { renderer: 'svg' });
    chart.setOption({
      animation: false, // Disable animations to prevent flickering
      title: { text: '${bucket}', left: 'center' },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', snap: true },
        formatter: function(params) {
          const timestamp = params[0].value[0];
          const date = new Date(timestamp);
          let result = date.toLocaleString('en-US', { hour12: true });
          params.forEach(p => {
            const series = data.series[p.seriesIndex + 1];
            const value = p.value[1];
            if (value !== null && !isNaN(value)) {
              result += '<br/>' + series.label + ': ' + value.toFixed(2) + ' ' + (series.units || '');
            }
          });
          return result;
        }
      },
      legend: { data: legendData, top: 30, type: 'scroll' },
      xAxis: {
        type: 'time',
        name: 'Time',
        axisLabel: {
          formatter: function(value) {
            return new Date(value).toLocaleString('en-US', {
              hour12: true,
              hour: 'numeric',
              minute: '2-digit'
            });
          }
        }
      },
      yAxis: { type: 'value', name: yAxisName, min: paddedMin, max: paddedMax },
      toolbox: { feature: { dataZoom: { yAxisIndex: 'none' }, restore: {}, saveAsImage: {} } },
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, filterMode: 'filter' },
        { type: 'inside', xAxisIndex: 0, filterMode: 'filter' },
        { type: 'inside', yAxisIndex: 0, filterMode: 'filter', minValueSpan: paddedMin - 10, maxValueSpan: paddedMax + 10 }
      ],
      series: seriesData
    });
  }
</script>
</body>
</html>
`;
            msg.payload = html;
            msg.statusCode = 200;
            node.send(msg);
        });
    }
    RED.nodes.registerType("history-template", HistoryTemplateNode);
};